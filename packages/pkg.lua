-- EndPkg Client
-- Version: 0.1.0

local API = "https://enderpkg-api.clown-speck.workers.dev/api"
local INSTALL_DIR = "/usr/bin"
local DATA_DIR = "/var/lib/endpkg"
local DB_FILE = DATA_DIR .. "/installed.json"

local function printError(message)
    printError = printError
    print("EndPkg error: " .. tostring(message))
end

local function request(url)
    if not http then
        return nil, "HTTP API is disabled"
    end

    local response, err = http.get(url)

    if not response then
        return nil, err or "Connection failed"
    end

    local code = response.getResponseCode()
    local body = response.readAll()
    response.close()

    if code < 200 or code >= 300 then
        return nil, "HTTP " .. code .. ": " .. body
    end

    return body
end

local function getJSON(url)
    local body, err = request(url)
    if not body then return nil, err end

    local ok, data = pcall(textutils.unserializeJSON, body)

    if not ok or type(data) ~= "table" then
        return nil, "Invalid API response"
    end

    return data
end

local function validSlug(slug)
    return type(slug) == "string"
        and #slug > 0
        and #slug <= 60
        and slug:match("^[a-z0-9][a-z0-9%-]*$") ~= nil
end

local function loadDatabase()
    if not fs.exists(DB_FILE) then
        return {}
    end

    local file = fs.open(DB_FILE, "r")
    if not file then return {} end

    local content = file.readAll()
    file.close()

    local ok, data = pcall(textutils.unserializeJSON, content)

    if not ok or type(data) ~= "table" then
        return {}
    end

    return data
end

local function saveDatabase(data)
    if not fs.exists(DATA_DIR) then
        fs.makeDir(DATA_DIR)
    end

    local file = fs.open(DB_FILE, "w")
    if not file then
        return false
    end

    file.write(textutils.serializeJSON(data))
    file.close()

    return true
end

local function listPackages()
    print("Fetching packages...")

    local data, err = getJSON(API .. "/packages")

    if not data then
        printError(err)
        return
    end

    local packages = data.packages or {}

    print("")
    print("Available packages:")

    if #packages == 0 then
        print("  No packages found.")
        return
    end

    for _, package in ipairs(packages) do
        print("  " .. package.slug .. "  " ..
            tostring(package.published_version or "?"))
    end

    print("")
    print(#packages .. " package(s) found.")
end

local function packageInfo(slug)
    if not validSlug(slug) then
        printError("Invalid package name")
        return
    end

    local data, err = getJSON(API .. "/packages/" .. slug)

    if not data then
        printError(err)
        return
    end

    local package = data.package

    if not package then
        printError("Package not found")
        return
    end

    print("")
    print("Package: " .. package.name)
    print("Slug: " .. package.slug)
    print("Author: " .. tostring(package.author))
    print("Version: " .. tostring(package.published_version))
    print("Description: " .. tostring(package.description or "None"))
    print("License: " .. tostring(package.license or "Unknown"))
    print("Platform: " .. tostring(package.platform or "Unknown"))

    print("")
    print("Published versions:")

    for _, version in ipairs(data.versions or {}) do
        print("  " .. version.version)
    end
end

local function installPackage(slug, force)
    if not validSlug(slug) then
        printError("Invalid package name")
        return
    end

    local destination = INSTALL_DIR .. "/" .. slug .. ".lua"
    local temporary = destination .. ".download"

    if fs.exists(destination) and not force then
        printError("Already installed. Use --force to overwrite.")
        return
    end

    print("Resolving " .. slug .. "...")

    local data, err = getJSON(API .. "/packages/" .. slug)

    if not data then
        printError(err)
        return
    end

    local package = data.package

    if not package or not package.published_version then
        printError("No published version found")
        return
    end

    local version = package.published_version

    print("Downloading " .. slug .. " " .. version .. "...")

    local url = API .. "/packages/" .. slug ..
        "/" .. version .. "/download"

    local source, downloadError = request(url)

    if not source then
        printError(downloadError)
        return
    end

    if #source == 0 then
        printError("Downloaded file is empty")
        return
    end

    if not fs.exists(INSTALL_DIR) then
        fs.makeDir(INSTALL_DIR)
    end

    local file = fs.open(temporary, "w")

    if not file then
        printError("Cannot write installation file")
        return
    end

    file.write(source)
    file.close()

    -- Replace destination only after download completed.
    if fs.exists(destination) then
        fs.delete(destination)
    end

    local ok, moveError = pcall(fs.move, temporary, destination)

    if not ok then
        if fs.exists(temporary) then
            fs.delete(temporary)
        end

        printError("Could not install file: " .. tostring(moveError))
        return
    end

    local installed = loadDatabase()

    installed[slug] = {
        name = package.name,
        version = version,
        path = destination
    }

    if not saveDatabase(installed) then
        print("Warning: Could not save installation database.")
    end

    print("")
    print("Successfully installed " .. slug .. "!")
    print("Version: " .. version)
    print("Location: " .. destination)
end

local function installedPackages()
    local installed = loadDatabase()

    print("")
    print("Installed packages:")

    local count = 0

    for slug, package in pairs(installed) do
        print("  " .. slug .. "  " .. tostring(package.version))
        count = count + 1
    end

    if count == 0 then
        print("  No packages installed.")
    end

    print("")
    print(count .. " installed package(s).")
end

local function help()
    print("")
    print("EndPkg 0.1.0")
    print("Package manager for CC:Tweaked")
    print("")
    print("Usage:")
    print("  pkg list")
    print("  pkg install <package>")
    print("  pkg install <package> --force")
    print("  pkg info <package>")
    print("  pkg installed")
    print("  pkg help")
    print("")
end

-- Command handling

local args = { ... }
local command = args[1]

if command == "list" then
    listPackages()

elseif command == "install" then
    if not args[2] then
        printError("Usage: pkg install <package>")
    else
        installPackage(args[2], args[3] == "--force")
    end

elseif command == "info" then
    if not args[2] then
        printError("Usage: pkg info <package>")
    else
        packageInfo(args[2])
    end

elseif command == "installed" then
    installedPackages()

elseif command == "help" or not command then
    help()

else
    printError("Unknown command: " .. tostring(command))
    help()
end
