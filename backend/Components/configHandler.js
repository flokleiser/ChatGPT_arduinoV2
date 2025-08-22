import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { USBConfigWatcher } from './USBConfigWatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');
// Create a single USB watcher instance for config detection
const usbDetector = new USBConfigWatcher();

async function loadConfig(existingConfig = null) {
  console.log(existingConfig)
  if (existingConfig) {
    console.log('🔄 Reloading existing configuration...');
    return existingConfig;
  }
  try {
    console.log('📋 Loading configuration...');
    
    // 1. First check for USB config using the USB watcher's detection logic
    const usbConfigPath = await findUSBConfig();
    if (usbConfigPath) {
      console.log(`📱 Using config from USB: ${usbConfigPath}`);
      return await loadFromUSB(usbConfigPath);
    }
    
    // 2. Fallback to local config
    console.log('📁 Using local config file');
    return await loadFromLocal();
    
  } catch (error) {
    console.error('❌ Error loading configuration:', error);
    throw error;
  }
}

/**
 * Find USB config using the same logic as USBConfigWatcher
 */
async function findUSBConfig() {
  try {
    // Use the USB watcher's scan method directly
    const configs = await usbDetector.scanForConfig();
    
    if (configs.length > 0) {
      // Use the first config found
      return configs[0];
    }
    
    return null;
  } catch (error) {
    console.debug('No USB config found:', error.message);
    return null;
  }
}

/**
 * Load config from USB drive
 */
async function loadFromUSB(configPath) {
  try {
    // Check if file exists
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    
    // Method 1: Try dynamic import (works if USB supports ES modules)
    try {
      const configModule = await import(configPath);
      return configModule.config || configModule.default;
    } catch (importError) {
      console.log('ES module import failed, trying alternative methods...');
    }
    
    // Method 2: Read as text and create temporary ES module
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      
      // Create a temporary file in the project directory
    
      const tempDir = path.join(projectRoot, 'scratch_files');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      
      const tempConfigPath = path.join(__dirname, `temp-usb-config-${Date.now()}.mjs`);
      
      // Write the config content to temp file
      fs.writeFileSync(tempConfigPath, configContent);
      
      try {
        // Import the temporary file
        const configModule = await import(`file://${tempConfigPath}?t=${Date.now()}`);
        const config = configModule.config || configModule.default;
        
        // Clean up temp file
        fs.unlinkSync(tempConfigPath);
         console.log('Text-based import successful:');
        return config;
      } catch (tempError) {
        // Clean up temp file even if import fails
        if (fs.existsSync(tempConfigPath)) {
          fs.unlinkSync(tempConfigPath);
        }
        console.log('Text-based import failed:', tempError);
        throw tempError;
      }
    } catch (textError) {
      console.log('Text-based import failed:', textError.message);
    }
    
    // Method 3: Evaluate as CommonJS-style module
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      
      // Create a sandbox environment for the config
      const sandbox = {
        module: { exports: {} },
        exports: {},
        require: () => { throw new Error('require() not available in USB config'); },
        console: console,
        process: { env: process.env }
      };
      
      // Execute the config file content
      const vm = await import('vm');
      const script = new vm.Script(configContent);
      script.runInNewContext(sandbox);
      
      // Try to extract config from different export patterns
      return sandbox.module.exports.config || 
             sandbox.module.exports.default || 
             sandbox.module.exports ||
             sandbox.exports.config ||
             sandbox.exports;
             
    } catch (vmError) {
      console.error('VM execution failed:', vmError.message);
      throw new Error(`Failed to load USB config: ${vmError.message}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to load config from USB:', error);
    throw error;
  }
}

/**
 * Load local config file
 */
async function loadFromLocal() {
  try {
      // Default config path (relative to this file)

    const localConfigPath = path.join(projectRoot, 'config.js');
    const configModule = await import(localConfigPath);
    return configModule.config;
  } catch (error) {
    console.error('❌ Failed to load local config:', error);
    throw error;
  }
}

/**
 * Get the USB detector instance (for use by server.js)
 */
function getUSBDetector() {
  return usbDetector;
}

export { loadConfig, getUSBDetector, loadFromUSB };