/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

if (process.platform === 'win32') {
  const electron = require('electron')
  const path = require('path')
  const childProcess = require('child_process')
  const spawn = childProcess.spawn
  const spawnSync = childProcess.spawnSync
  const execSync = childProcess.execSync
  const app = electron.app
  const fs = require('fs')
  const Channel = require('./channel')
  const cmdLine = require('./cmdLine')
  const promoCodeFirstRunStorage = require('./promoCodeFirstRunStorage')

  let appUserModelId = 'com.squirrel.brave.Brave'
  switch (Channel.channel()) {
    case 'nightly':
      appUserModelId = 'com.squirrel.BraveNightly.BraveNightly'
      break
    case 'developer':
      appUserModelId = 'com.squirrel.BraveDeveloper.BraveDeveloper'
      break
    case 'beta':
      appUserModelId = 'com.squirrel.BraveBeta.BraveBeta'
      break
    case 'dev':
      appUserModelId = 'com.squirrel.brave.Brave'
      break
    default:
      appUserModelId = 'com.squirrel.brave.Brave'
      break
  }

  const getBraveBinPath = () => {
    const appPath = app.getPath('exe')
    return path.dirname(appPath)
  }

  const getBraveDefaultsBinPath = () => {
    const appDir = getBraveBinPath()
    return path.join(appDir, 'resources', 'braveDefaults.exe')
  }

  const getVisualElementsManifestPath = () => {
    const appDir = getBraveBinPath()
    return path.join(appDir, 'resources', 'Update.VisualElementsManifest.xml')
  }

  const copyManifestFile = () => {
    const versionedRoot = getBraveBinPath()
    let updateRoot = versionedRoot.split('\\')
    updateRoot.pop()
    updateRoot = updateRoot.join('\\')
    const cmd = 'copy "' + getVisualElementsManifestPath() + '" "' + updateRoot + '"'
    execSync(cmd)
  }

  const getBraveCoreInstallPath = () => {
    const braveCoreInstallLocations = [
      '%USERPROFILE%\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application',
      '%ProgramFiles(x86)%\\BraveSoftware\\Brave-Browser\\Application',
      '%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application'
    ]

    // check for existing installations
    for (let i = 0; i < braveCoreInstallLocations.length; i++) {
      const path = braveCoreInstallLocations[i]
      const resolvedPath = path.replace(/%([^%]+)%/g, function (_, variableToResolve) {
        return process.env[variableToResolve]
      })
      if (fs.existsSync(resolvedPath)) {
        console.log(`brave-core already installed at "${resolvedPath}"`)
        return resolvedPath
      }
    }

    return false
  }

  module.exports = function () {
    const shouldQuit = require('electron-squirrel-startup')
    const channel = Channel.channel()
    const isSquirrelInstall = process.argv.includes('--squirrel-install')
    const isSquirrelUpdate = process.argv.includes('--squirrel-updated')
    const isSquirrelUninstall = process.argv.includes('--squirrel-uninstall')
    const isSquirrelFirstRun = process.argv.includes('--squirrel-firstrun')

    // Events like `--squirrel-install` and `--squirrel-updated`
    // are fired by Update.exe DURING the install/upgrade. Since
    // we don't intend to actually launch the executable, we need
    // to exit after performing housekeeping tasks.
    if (isSquirrelInstall || isSquirrelUpdate) {
      // Detect promoCode (via CLI) and write to disk for later use
      const promoCode = isSquirrelInstall && cmdLine.getFirstRunPromoCode()
      if (promoCode) {
        promoCodeFirstRunStorage.writeFirstRunPromoCodeSync(promoCode)
      }
      // The manifest file is used to customize the look of the Start menu tile.
      // This function copies it from the versioned folder to the parent folder
      // (where the auto-update executable lives)
      copyManifestFile()
      // Launch defaults helper to add defaults on install
      spawn(getBraveDefaultsBinPath(), [], { detached: true })
    } else if (isSquirrelUninstall) {
      // Launch defaults helper to remove defaults on uninstall
      // Sync to avoid file path in use on uninstall
      spawnSync(getBraveDefaultsBinPath(), ['-uninstall'])
    }

    // Quit if this is only an install or update event.
    // This logic also creates the shortcuts (desktop, etc)
    if (shouldQuit(channel)) {
      process.exit(0)
    }

    // If executable is on BETA/DEVELOPER/NIGHTLY channels, there
    // is a different `user-data-dir-name`. This logic will
    // relaunch using the proper profile if it was omitted for
    // some reason.
    const userDataDirSwitch = '--user-data-dir-name=brave-' + channel
    if (channel !== 'dev' && !process.argv.includes(userDataDirSwitch) &&
        !process.argv.includes('--relaunch') &&
        !process.argv.includes('--user-data-dir-name=brave-development')) {
      delete process.env.CHROME_USER_DATA_DIR
      if (isSquirrelFirstRun) {
        app.relaunch({args: [userDataDirSwitch, '--relaunch']})
      } else {
        app.relaunch({args: process.argv.slice(1).concat([userDataDirSwitch, '--relaunch'])})
      }
      app.exit()
      return
    }

    app.on('will-finish-launching', () => {
      app.setAppUserModelId(appUserModelId)
    })

    // If brave-core is installed, find the path and version
    const braveCoreInstallPath = getBraveCoreInstallPath()
    if (braveCoreInstallPath) {
      const getVersionCmd = `wmic datafile where name='${braveCoreInstallPath.replace(/\\/g, '\\\\')}\\\\brave.exe' get Version /value`
      let braveCoreVersion
      try {
        // format will be like `Version=70.0.56.8`
        braveCoreVersion = execSync(getVersionCmd).toString().trim()
        const keyValue = braveCoreVersion.split('=')
        if (keyValue.length === 2) {
          // remove the Chromium version from the string
          const versionAsArray = keyValue[1].split('.')
          if (versionAsArray.length === 4) {
            braveCoreVersion = versionAsArray.slice(1).join('.')
          }
        }
      } catch (e) {}

      return {braveCoreInstalled: true, braveCoreInstallPath, braveCoreVersion}
    }

    return {braveCoreInstalled: false}
  }
}
