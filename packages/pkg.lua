
-- #enderpkg
-- #name: "EnderPkgCli"
-- #description: "The Package manager for EnderPkg."
-- #author: "EnderPkg"
-- #version: "0.3.0"
-- #license: "MIT"
-- #platform: "cc-tweaked"
-- #dependencies: []

local API = "https://enderpkg-api.clown-speck.workers.dev/api"
local INSTALL_DIR = "/usr/bin"
local DATA_DIR = "/var/lib/endpkg"
local DB_FILE = DATA_DIR .. "/installed.json"
local CACHE_FILE = DATA_DIR .. "/packages.json"

-- Output

local function errorMsg(message)
    printError("EndPkg error: " .. tostring(message))
end

local function ensureDirectory(path)
    if not fs.exists(path) then
        fs.makeDir(path)
    end
end

-- HTTP

local function request(url)
    if not http then
        return nil, "HTTP API is disabled"
    end

    local ok, response, err = pcall(http.get, url)

    if not ok then
        return nil, tostring(response)
    end

    if not response then
        return nil, err or "Connection failed"
    end

    local code = response.getResponseCode()
    local body = response.readAll()
    response.close()

    if code < 200 or code >= 300 then
        return nil, "HTTP " .. tostring(code) .. ": " .. body
    end

    return body
end

local function getJSON(url)
    local body, err = request(url)

    if not body then
        return nil, err
    end

    local ok, data = pcall(textutils.unserializeJSON, body)

    if not ok or type(data) ~= "table" then
        return nil, "Invalid API response"
    end

    return data
end


-- Progress UI

local function formatBytes(bytes)
    if bytes >= 1024 * 1024 then
        return string.format("%.2f MB", bytes / 1024 / 1024)
    elseif bytes >= 1024 then
        return string.format("%.1f KB", bytes / 1024)
    end

    return bytes .. " B"
end

local function getHeader(headers, name)
    for key, value in pairs(headers or {}) do
        if key:lower() == name:lower() then
            return tonumber(value)
        end
    end

    return nil
end

local function drawProgress(name, received, total, startTime)
    local elapsed = os.clock() - startTime
    local speed = elapsed > 0 and received / elapsed or 0

    local percent = total and total > 0
        and math.min(100, received / total * 100)
        or nil

    local remaining = total and speed > 0
        and math.max(0, (total - received) / speed)
        or nil

    local terminal = term.current()
    local width, height = terminal.getSize()
    local _, oldY = terminal.getCursorPos()

    local barWidth = math.max(5, math.min(20, width - 25))

    local filled = percent
        and math.floor(barWidth * percent / 100)
        or 0

    local bar = string.rep("#", filled) ..
        string.rep("-", barWidth - filled)

    local progressText

    if percent then
        progressText = string.format("%3d%%", math.floor(percent))
    else
        progressText = "Unknown"
    end

    local timeText = remaining
        and string.format("%ds left", math.ceil(remaining))
        or "ETA unknown"

    local line = name .. " [" .. bar .. "] " ..
        progressText .. " " .. formatBytes(received)

    if total then
        line = line .. "/" .. formatBytes(total)
    end

    line = line .. " " .. timeText

    terminal.setCursorPos(1, oldY)
    terminal.clearLine()
    terminal.write(line:sub(1, width))
end

-- Streaming downloader

local function downloadWithProgress(url, slug)
    if not http then
        return false, "HTTP API is disabled"
    end

    print("Downloading " .. slug .. "...")

    local ok, response, err = pcall(http.get, url, nil, true)

    if not ok then
        return false, tostring(response)
    end

    if not response then
        return false, err or "Connection failed"
    end

    local code = response.getResponseCode()

    if code < 200 or code >= 300 then
        local body = response.readAll()
        response.close()

        return false, "HTTP " .. code .. ": " .. body
    end

    local headers = response.getResponseHeaders()
    local total = getHeader(headers, "Content-Length")

    local temporary = INSTALL_DIR .. "/" .. slug .. ".lua.download"

    ensureDirectory(INSTALL_DIR)

    if fs.exists(temporary) then
        fs.delete(temporary)
    end

    local file = fs.open(temporary, "wb")

    if not file then
        response.close()
        return false, "Cannot create temporary file"
    end

    local received = 0
    local startTime = os.clock()
    local lastUpdate = 0
    local failed = nil

    while true do
        local chunkOk, chunk = pcall(response.read, 8192)

        if not chunkOk then
            failed = tostring(chunk)
            break
        end

        if not chunk then
            break
        end

        local writeOk, writeError = pcall(file.write, chunk)

        if not writeOk then
            failed = tostring(writeError)
            break
        end

        received = received + #chunk

        if os.clock() - lastUpdate >= 0.2 then
            drawProgress(slug, received, total, startTime)
            lastUpdate = os.clock()
        end
    end

    response.close()
    file.close()

    drawProgress(slug, received, total, startTime)
    print("")

    if failed then
        if fs.exists(temporary) then
            fs.delete(temporary)
        end

        return false, failed
    end

    if received == 0 then
        fs.delete(temporary)
        return false, "Downloaded file is empty"
    end

    if total and received ~= total then
        fs.delete(temporary)
        return false, "Download incomplete"
    end

    return true, temporary, received
end

-- Validation

local function validSlug(slug)
    return type(slug) == "string"
        and #slug > 0
        and #slug <= 60
        and slug:match("^[a-z0-9][a-z0-9%-]*$") ~= nil
end

local function parseVersion(version)
    if type(version) ~= "string" then
        return nil
    end

    local major, minor, patch =
        version:match("^(%d+)%.(%d+)%.(%d+)$")

    if not major then
        return nil
    end

    return {
        tonumber(major),
        tonumber(minor),
        tonumber(patch)
    }
end

local function compareVersions(a, b)
    local va = parseVersion(a)
    local vb = parseVersion(b)

    if not va or not vb then
        return nil
    end

    for i = 1, 3 do
        if va[i] > vb[i] then return 1 end
        if va[i] < vb[i] then return -1 end
    end

    return 0
end

-- Local database

local function loadJSONFile(path)
    if not fs.exists(path) then
        return {}
    end

    local file = fs.open(path, "r")

    if not file then
        return {}
    end

    local content = file.readAll()
    file.close()

    local ok, data = pcall(textutils.unserializeJSON, content)

    if not ok or type(data) ~= "table" then
        return {}
    end

    return data
end

local function saveJSONFile(path, data)
    ensureDirectory(DATA_DIR)

    local file = fs.open(path, "w")

    if not file then
        return false
    end

    file.write(textutils.serializeJSON(data))
    file.close()

    return true
end

local function loadDatabase()
    return loadJSONFile(DB_FILE)
end

local function saveDatabase(data)
    return saveJSONFile(DB_FILE, data)
end

-- User confirmation

local function askConfirmation(question)
    while true do
        write(question .. " [y/n]: ")

        local answer = read()
        answer = answer:lower():gsub("%s+", "")

        if answer == "y" then
            return true
        elseif answer == "n" then
            return false
        else
            print("Please answer y or n.")
        end
    end
end

-- Package API

local function getPackageList()
    return getJSON(API .. "/packages")
end

local function getPackageInfo(slug)
    if not validSlug(slug) then
        return nil, "Invalid package name"
    end

    local data, err = getJSON(API .. "/packages/" .. slug)

    if not data then
        return nil, err
    end

    if not data.package then
        return nil, "Package not found"
    end

    return data
end

-- Package installation


local function installVersion(slug, version)
    local destination = INSTALL_DIR .. "/" .. slug .. ".lua"
    local backup = destination .. ".backup"

    local url = API .. "/packages/" .. slug ..
        "/" .. version .. "/download"

    print("Preparing download...")

    local success, temporary =
        downloadWithProgress(url, slug)

    if not success then
        errorMsg(temporary)
        return false
    end

    local hadOldFile = fs.exists(destination)

    if fs.exists(backup) then
        fs.delete(backup)
    end

    -- Back up the old installation
    if hadOldFile then
        local ok, moveError = pcall(
            fs.move,
            destination,
            backup
        )

        if not ok then
            if fs.exists(temporary) then
                fs.delete(temporary)
            end

            errorMsg("Cannot create backup: " .. tostring(moveError))
            return false
        end
    end

    -- Move downloaded file into place
    local ok, moveError = pcall(
        fs.move,
        temporary,
        destination
    )

    if not ok then
        if fs.exists(temporary) then
            fs.delete(temporary)
        end

        if hadOldFile and fs.exists(backup) then
            pcall(fs.move, backup, destination)
        end

        errorMsg("Installation failed: " .. tostring(moveError))
        return false
    end

    -- Verify package metadata
    local installed = loadDatabase()
    local info, infoError = getPackageInfo(slug)

    if not info then
        if fs.exists(destination) then
            fs.delete(destination)
        end

        if hadOldFile and fs.exists(backup) then
            pcall(fs.move, backup, destination)
        end

        errorMsg("Could not verify package: " .. tostring(infoError))
        return false
    end

    local package = info.package

    installed[slug] = {
        name = package.name,
        version = version,
        path = destination
    }

    if not saveDatabase(installed) then
        if fs.exists(destination) then
            fs.delete(destination)
        end

        if hadOldFile and fs.exists(backup) then
            pcall(fs.move, backup, destination)
        end

        errorMsg("Could not save installation database")
        return false
    end

    -- Remove backup after successful installation
    if fs.exists(backup) then
        fs.delete(backup)
    end

    print("Successfully installed " .. slug .. "!")
    print("Version: " .. version)

    return true
end


local function installPackage(slug, force)
    if not validSlug(slug) then
        errorMsg("Invalid package name")
        return
    end

    local destination = INSTALL_DIR .. "/" .. slug .. ".lua"

    if fs.exists(destination) and not force then
        errorMsg("Already installed. Use --force to overwrite.")
        return
    end

    print("Resolving " .. slug .. "...")

    local data, err = getPackageInfo(slug)

    if not data then
        errorMsg(err)
        return
    end

    local version = data.package.published_version

    if not version then
        errorMsg("No published version found")
        return
    end

    installVersion(slug, version)
end

-- Package listing

local function listPackages()
    print("Fetching packages...")

    local data, err = getPackageList()

    if not data then
        errorMsg(err)
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
        print("  " .. tostring(package.slug) .. "  " ..
            tostring(package.published_version or "?"))
    end

    print("")
    print(#packages .. " package(s) found.")
end

-- Package information

local function packageInfo(slug)
    local data, err = getPackageInfo(slug)

    if not data then
        errorMsg(err)
        return
    end

    local package = data.package

    print("")
    print("Package: " .. tostring(package.name))
    print("Slug: " .. tostring(package.slug))
    print("Author: " .. tostring(package.author))
    print("Version: " .. tostring(package.published_version))
    print("Description: " .. tostring(package.description or "None"))
    print("License: " .. tostring(package.license or "Unknown"))
    print("Platform: " .. tostring(package.platform or "Unknown"))

    print("")
    print("Published versions:")

    for _, version in ipairs(data.versions or {}) do
        print("  " .. tostring(version.version))
    end
end

-- Installed packages

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

-- Remove package

local function removePackage(slug)
    if not validSlug(slug) then
        errorMsg("Invalid package name")
        return
    end

    local installed = loadDatabase()

    if not installed[slug] then
        errorMsg("Package is not installed")
        return
    end

    local destination = INSTALL_DIR .. "/" .. slug .. ".lua"

    if not askConfirmation("Remove " .. slug .. "?") then
        print("Removal cancelled.")
        return
    end

    if fs.exists(destination) then
        fs.delete(destination)
    end

    installed[slug] = nil

    if not saveDatabase(installed) then
        errorMsg("Could not update installation database")
        return
    end

    print("Successfully removed " .. slug .. ".")
end

-- Update package index

local function updatePackages()
    print("Updating package index...")

    local data, err = getPackageList()

    if not data then
        errorMsg(err)
        return
    end

    if not saveJSONFile(CACHE_FILE, data.packages or {}) then
        errorMsg("Could not save package index")
        return
    end

    print("Package index updated.")
    print(tostring(#(data.packages or {})) .. " package(s) available.")
end

-- Upgrade

local function findAvailableVersion(packages, slug)
    for _, package in ipairs(packages) do
        if package.slug == slug then
            return package.published_version
        end
    end

    return nil
end

local function upgradeOne(slug, targetVersion)
    print("")
    print("Upgrading " .. slug .. "...")

    return installVersion(slug, targetVersion)
end

local function upgradePackages(targetSlug, singleQuestion, automatic)
    print("Checking for updates...")

    local installed = loadDatabase()

    if targetSlug and not validSlug(targetSlug) then
        errorMsg("Invalid package name")
        return
    end

    if targetSlug and not installed[targetSlug] then
        errorMsg("Package is not installed: " .. targetSlug)
        return
    end

    local data, err = getPackageList()

    if not data then
        errorMsg(err)
        return
    end

    local packages = data.packages or {}
    local updates = {}

    for slug, localPackage in pairs(installed) do
        if not targetSlug or slug == targetSlug then
            local available = findAvailableVersion(packages, slug)

            if available then
                local comparison = compareVersions(
                    available,
                    localPackage.version
                )

                if comparison == nil then
                    print("Warning: Cannot compare versions for " .. slug)
                elseif comparison > 0 then
                    table.insert(updates, {
                        slug = slug,
                        oldVersion = localPackage.version,
                        newVersion = available
                    })
                end
            end
        end
    end

    table.sort(updates, function(a, b)
        return a.slug < b.slug
    end)

    if #updates == 0 then
        print("All packages are up to date.")
        return
    end

    print("")
    print("Updates available:")
    print("")

    for _, update in ipairs(updates) do
        print("  " .. update.slug .. "  " ..
            tostring(update.oldVersion) .. " -> " ..
            tostring(update.newVersion))
    end

    print("")

    if not singleQuestion and not automatic then
        if not askConfirmation("Upgrade " .. #updates .. " package(s)?") then
            print("Upgrade cancelled.")
            return
        end
    end

    local upgraded = 0
    local skipped = 0
    local failed = 0

    for _, update in ipairs(updates) do
        local shouldUpgrade = automatic

        if singleQuestion and not automatic then
            shouldUpgrade = askConfirmation(
                "Upgrade " .. update.slug .. " (" ..
                tostring(update.oldVersion) .. " -> " ..
                tostring(update.newVersion) .. ")?"
            )
        elseif not singleQuestion then
            shouldUpgrade = true
        end

        if shouldUpgrade then
            if upgradeOne(update.slug, update.newVersion) then
                upgraded = upgraded + 1
            else
                failed = failed + 1
            end
        else
            print("Skipped " .. update.slug .. ".")
            skipped = skipped + 1
        end
    end

    print("")
    print("Upgrade summary:")
    print("  Upgraded: " .. upgraded)
    print("  Skipped:  " .. skipped)
    print("  Failed:   " .. failed)
end

-- Help

local function help()
    print("")
    print("EndPkg 0.2.0")
    print("Package manager for CC:Tweaked")
    print("")
    print("Usage:")
    print("  pkg list")
    print("  pkg info <package>")
    print("  pkg install <package>")
    print("  pkg install <package> --force")
    print("  pkg installed")
    print("  pkg remove <package>")
    print("  pkg update")
    print("  pkg upgrade")
    print("  pkg upgrade -sq")
    print("  pkg upgrade <package>")
    print("  pkg upgrade <package> -sq")
    print("  pkg upgrade -y")
    print("  pkg help")
    print("")
end

-- Command handling

local args = { ... }
local command = args[1]

if command == "list" then
    listPackages()

elseif command == "info" then
    if not args[2] then
        errorMsg("Usage: pkg info <package>")
    else
        packageInfo(args[2])
    end

elseif command == "install" then
    if not args[2] then
        errorMsg("Usage: pkg install <package>")
    else
        installPackage(args[2], args[3] == "--force")
    end

elseif command == "installed" then
    installedPackages()

elseif command == "remove" then
    if not args[2] then
        errorMsg("Usage: pkg remove <package>")
    else
        removePackage(args[2])
    end

elseif command == "update" then
    updatePackages()

elseif command == "upgrade" then
    local targetSlug
    local singleQuestion = false
    local automatic = false

    for i = 2, #args do
        local arg = args[i]

        if arg == "-sq" then
            singleQuestion = true
        elseif arg == "-y" then
            automatic = true
        elseif not targetSlug then
            targetSlug = arg
        else
            errorMsg("Unknown argument: " .. tostring(arg))
            return
        end
    end

    if singleQuestion and automatic then
        errorMsg("Cannot use -sq and -y together")
    else
        upgradePackages(targetSlug, singleQuestion, automatic)
    end

elseif command == "help" or not command then
    help()

else
    errorMsg("Unknown command: " .. tostring(command))
    help()
end
