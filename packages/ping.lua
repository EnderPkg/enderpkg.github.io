-- #enderpkg
-- #name: "Ping"
-- #description: "just says hello"
-- #author: "EnderPkg"
-- #version: "1.0.0"
-- #license: "MIT"
-- #platform:"cc-tweaked"
-- #dependencies: []

print("Hello World!")

local speaker = peripheral.find("speaker")
if speaker then
  speaker.playNote("pling", 1, 12)
end
