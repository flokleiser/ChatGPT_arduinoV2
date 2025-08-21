import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';

const execAsync = promisify(exec);

class USBConfigWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.watchInterval = options.watchInterval || 2000;
    this.mountPoints = options.mountPoints || ['/Volumes', '/media', '/mnt'];
    this.configFileName = options.configFileName || 'config.js';
    this.isWatching = false;
    this.watchTimer = null;
    this.currentConfigPath = null;
    this.currentConfigHash = null;
    
    console.log('� USB Config Watcher initialized');
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
    console.log(`📄 Looking for config file: ${this.configFileName}`);
    
    this.isWatching = true;
    
    // Initial scan
    this.scanForConfig();
    
    // Set up periodic scanning
    this.watchTimer = setInterval(() => {
      this.scanForConfig();
    }, this.watchInterval);
    
    console.log(`✅ USB Config Watcher started (checking every ${this.watchInterval}ms)`);
  }

  /**
   * Stop watching for USB config changes
   */
  stop() {
    if (!this.isWatching) {
      return;
    }

    console.log('🛑 Stopping USB config watcher...');
    
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    
    this.isWatching = false;
    console.log('✅ USB Config Watcher stopped');
  }

  /**
   * Scan mount points for config files
   */
  scanForConfig() {
    if (!this.isWatching) {
      return;
    }

    let foundConfigPath = null;

    // Scan each mount point
    for (const mountPoint of this.mountPoints) {
      try {
        if (fs.existsSync(mountPoint)) {
          const entries = fs.readdirSync(mountPoint);
          
          for (const entry of entries) {
            const entryPath = path.join(mountPoint, entry);
            
            try {
              const stats = fs.statSync(entryPath);
              if (stats.isDirectory()) {
                const configPath = path.join(entryPath, this.configFileName);
                
                if (fs.existsSync(configPath)) {
                  console.log(`🔍 Found config file: ${configPath}`);
                  foundConfigPath = configPath;
                  break;
                }
              }
            } catch (error) {
              // Skip entries we can't access
              continue;
            }
          }
        }
      } catch (error) {
        // Skip mount points we can't access
        continue;
      }
      
      if (foundConfigPath) {
        break;
      }
    }

    // Check if config has changed
    if (this.hasConfigFileChanged(foundConfigPath)) {
      this.handleConfigChange(foundConfigPath);
    }
  }

  /**
   * Check if config file has changed
   */
  hasConfigFileChanged(configPath) {
    // New config found
    if (configPath && !this.currentConfigPath) {
      return true;
    }
    
    // Config removed
    if (!configPath && this.currentConfigPath) {
      return true;
    }
    
    // Config path changed
    if (configPath && this.currentConfigPath && configPath !== this.currentConfigPath) {
      return true;
    }
    
    // Check content hash if same path
    if (configPath && this.currentConfigPath === configPath) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const newHash = this.generateHash(content);
        return newHash !== this.currentConfigHash;
      } catch (error) {
        return false;
      }
    }
    
    return false;
  }

  /**
   * Handle config file change
   */
  async handleConfigChange(newConfigPath) {
    if (newConfigPath && newConfigPath !== this.currentConfigPath) {
      console.log(`🔄 New USB config detected: ${newConfigPath}`);
      console.log(`📋 Loading configuration from USB...`);
      
      const previousPath = this.currentConfigPath;
      this.currentConfigPath = newConfigPath;
      
      // Update hash
      if (newConfigPath) {
        try {
          const content = fs.readFileSync(newConfigPath, 'utf8');
          this.currentConfigHash = this.generateHash(content);
          console.log(`✅ USB config loaded successfully`);
            this.emit('configChanged', {
            configPath: this.currentConfigPath,
            previousPath: previousPath
          });
        } catch (error) {
          console.error('❌ Error reading new USB config:', error.message);
          return;
        }
      }
      

    } else if (!newConfigPath && this.currentConfigPath) {
      console.log('📤 USB config removed');
      this.currentConfigPath = null;
      this.currentConfigHash = null;
      this.emit('configRemoved');
    }
  }

  async eject() {
  // Auto-eject the USB drive first, then emit config change
      console.log(`💾 Auto-ejecting USB drive before restart...`);
      setTimeout(async () => {
        await this.ejectUSBDrive(this.currentConfigPath);
      }, 1000); // Brief delay to ensure file reading is complete

  }

  /**
   * Eject the USB drive containing the config file
   */
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
   * Get the USB mount point from a config file path
   */
    getUSBMountPoint(configPath) {
    // Find which USB base path contains this config
    for (const basePath of this.mountPoints) {
        if (configPath.startsWith(basePath)) {
        // Extract the mount point (e.g., /Volumes/USB_DRIVE from /Volumes/USB_DRIVE/config.js)
        const relativePath = path.relative(basePath, configPath);
        const mountDir = relativePath.split(path.sep)[0];
        return path.join(basePath, mountDir);
        }
    }
    return null;
    }

  /**
   * Generate a simple hash for content comparison
   */
  generateHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Get current USB config path if any
   */
  getCurrentConfigPath() {
    return this.currentConfigPath;
  }
}

export default USBConfigWatcher;
