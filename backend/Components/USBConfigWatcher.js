import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';

const execAsync = promisify(exec);

class USBConfigWatcher extends EventEmitter {
    constructor() {
        super();
        this.watchTimer = null;
        this.watchInterval = 5000; // Check every 5 seconds
        this.lastConfigs = new Map();
        this.isWatching = false;
        // Detect platform and set appropriate mount points
        const platform = process.platform;
        const username = process.env.USER || process.env.USERNAME || 'pi';

        if (platform === 'darwin') {
            // macOS
            this.mountPoints = ['/Volumes'];
        } else if (platform === 'linux') {
            // Linux/Raspberry Pi - check multiple possible mount locations
            this.mountPoints = [
                `/media/${username}`,  // Standard Linux user mounts (e.g., /media/pi/)
                '/media',              // Generic media mount point
                '/mnt',                // Alternative mount point
                '/run/media',          // Some Linux distributions use this
            ];
        } else if (platform === 'win32') {
            // Windows - check all drive letters
            this.mountPoints = ['A:', 'B:', 'C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:', 'K:', 'L:', 'M:', 'N:', 'O:', 'P:', 'Q:', 'R:', 'S:', 'T:', 'U:', 'V:', 'W:', 'X:', 'Y:', 'Z:'];
        } else {
            // Fallback
            this.mountPoints = ['/media', '/mnt'];
        }

        console.log(`📱 USB mount points for ${platform}:`, this.mountPoints);
    }

    /**
     * Scan for config.js files on USB drives
     */
    async scanForConfig() {
        const configs = [];

        for (const mountPoint of this.mountPoints) {
            try {
                if (!fs.existsSync(mountPoint)) {
                    continue;
                }

                // Get all subdirectories in the mount point
                const entries = fs.readdirSync(mountPoint, { withFileTypes: true });

                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const usbPath = path.join(mountPoint, entry.name);
                        const configPath = path.join(usbPath, 'config.js');

                        // Check if config.js exists in this USB drive
                        if (fs.existsSync(configPath)) {
                            console.log(`📄 Found config at: ${configPath}`);
                            this.emit('configFound', {
                                configPath: configPath,
                            });
                            configs.push(configPath);
                        }
                    }
                }
            } catch (error) {
                // Ignore permission errors or mount point access issues
                console.debug(`Could not scan ${mountPoint}:`, error.message);
            }
        }

        return configs;
    }

    /**
     * Get the USB mount point from a config file path
     */
    getUSBMountPoint(configPath) {
        // Find which USB base path contains this config
        for (const basePath of this.mountPoints) {
            if (configPath.startsWith(basePath)) {
                // Extract the mount point (e.g., /media/pi/0085-0B871 from /media/pi/0085-0B871/config.js)
                const relativePath = path.relative(basePath, configPath);
                const mountDir = relativePath.split(path.sep)[0];
                return path.join(basePath, mountDir);
            }
        }
        return null;
    }

    /**
     * Get volume name for ejection (works better on Raspberry Pi)
     */
    getVolumeFromPath(configPath) {
        try {
            // For Raspberry Pi, extract the volume UUID/label from the path
            // e.g., /media/pi/0085-0B871/config.js -> 0085-0B871
            const mountPoint = this.getUSBMountPoint(configPath);
            if (mountPoint) {
                return path.basename(mountPoint);
            }

            // Fallback: check different mount point patterns
            const mountPatterns = [
                /\/media\/[^\/]+\/([^\/]+)/, // Linux: /media/username/volume
                /\/mnt\/([^\/]+)/,           // Linux alternative: /mnt/volume
                /\/Volumes\/([^\/]+)/,       // macOS: /Volumes/volume
                /^([A-Z]:)/                  // Windows: C:
            ];

            for (const pattern of mountPatterns) {
                const match = configPath.match(pattern);
                if (match) {
                    return match[1] || match[0];
                }
            }

            return null;
        } catch (error) {
            console.error('Error getting volume from path:', error);
            return null;
        }
    }

    /**
   * Start watching for USB config changes
   */
    start() {
        if (this.isWatching) {
            console.log('⚠️  USB Config Watcher is already running');
            return;
        }

        console.log('� Starting USB config watcher...');
        console.log(`📂 Watching mount points: ${this.mountPoints.join(', ')}`);

        this.isWatching = true;

        // Initial scan
        this.scanForConfig();

        // Set up periodic scanning
        this.watchTimer = setInterval(() => {
            //console.log('🔍 Scanning for USB config files...');
            this.scanForConfig();
        }, this.watchInterval);

        console.log(`✅ USB Config Watcher started (checking every ${this.watchInterval}ms)`);
    }

    /**
     * Eject USB volume (Raspberry Pi compatible)
     */
    stop() {
        if (!this.isWatching) {
            return;
        }
        if (this.watchTimer) {
            clearInterval(this.watchTimer);
            this.watchTimer = null;
        }

        this.isWatching = false;
        console.log('✅ USB Config Watcher stopped');
    }


    async ejectUSBDrive(configPath) {
    try {
      const usbMountPoint = this.getUSBMountPoint(configPath);
      if (!usbMountPoint) {
        console.log('⚠️  Could not determine USB mount point for ejection');
        return;
      }

      console.log(`💾 Ejecting USB drive: ${usbMountPoint}`);
      
      const platform = process.platform;
      let ejectCommand;
      
      switch (platform) {
        case 'darwin': // macOS
          ejectCommand = `diskutil eject "${usbMountPoint}"`;
          break;
        case 'linux': // Linux/Raspberry Pi
          ejectCommand = `umount "${usbMountPoint}" && eject "${usbMountPoint}"`;
          break;
        case 'win32': // Windows
          const driveLetter = usbMountPoint.split(':')[0];
          ejectCommand = `powershell.exe -Command "(New-Object -comObject Shell.Application).Namespace(17).ParseName('${driveLetter}:').InvokeVerb('Eject')"`;
          break;
        default:
          console.log(`⚠️  USB ejection not supported on platform: ${platform}`);
          return;
      }

      await execAsync(ejectCommand);
      console.log(`✅ USB drive ejected successfully: ${usbMountPoint}`);
      
      // Emit ejection event
      this.emit('usbEjected', { mountPoint: usbMountPoint, configPath });
      
    } catch (error) {
      console.error(`❌ Failed to eject USB drive: ${error.message}`);
      // Emit ejection failed event
      this.emit('usbEjectionFailed', { error: error.message, configPath });
    }
  }
    /**
     * Check if the watcher is currently active
     */
    isWatching() {
        return this.watchTimer !== null;
    }

}
export { USBConfigWatcher };
