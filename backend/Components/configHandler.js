import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

// Helper to resolve config.js from USB or fallback to default
export async function loadConfig() {
  // Default config path (relative to this file)
  let configPath = path.join(projectRoot, 'config.js');
  let isUsbConfig = false;

  //check if config.js exists in the project root
  if (!fs.existsSync(configPath)) {
    console.log(`config not found in project root: ${configPath}`);
  } 

  // Common USB mount points
  const usbPaths = [
    '/media',                // Linux
    '/mnt',                  // Linux
    '/Volumes',              // macOS
    'E:\\', 'F:\\', 'G:\\',  // Windows (add more if needed)
  ];

  // Try to find config.js on any USB drive
  for (const base of usbPaths) {
    try {
      if (fs.existsSync(base)) {
        const entries = fs.readdirSync(base);
        for (const entry of entries) {
          const usbDir = path.join(base, entry);
          const candidate = path.join(usbDir, 'config.js');
          if (fs.existsSync(candidate)) {
            configPath = candidate;
            isUsbConfig = true;
            console.log(`Using config from USB: ${candidate}`);
            break;
          }
        }
      }
      if (isUsbConfig) break;
    } catch (e) {
      // Ignore errors for non-existent drives
    }
  }

  try {
    if (isUsbConfig) {
      // Handle USB config files which may not be in ES module context
      return await loadUsbConfig(configPath);
    } else {
      // Load local config using normal ES module import
      const configModule = await import(pathToFileURL(configPath).href);
      return configModule.config;
    }
  } catch (error) {
    console.error(`Error loading config from ${configPath}:`, error.message);
    throw error;
  }
}

// Special handler for USB config files
export async function loadUsbConfig(configPath) {
  try {
    // First, try to import as ES module
    const configModule = await import(pathToFileURL(configPath).href);
    return configModule.config;
  } catch (esError) {
    console.log('ES module import failed, trying alternative method...');
    
    try {
      // Read the file content and create a temporary ES module
      const configContent = fs.readFileSync(configPath, 'utf8');
      
      // Create a temporary file with .mjs extension to force ES module loading
      const tempDir = path.join(projectRoot, 'scratch_files');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
      
      const tempConfigPath = path.join(tempDir, `config-${Date.now()}.mjs`);
      fs.writeFileSync(tempConfigPath, configContent);
      
      // Import the temporary ES module
      const configModule = await import(pathToFileURL(tempConfigPath).href);
      
      // Clean up temporary file
      fs.unlinkSync(tempConfigPath);
      
      return configModule.config;
    } catch (moduleError) {
      console.log('ES module method failed, trying text parsing...');
      
      // Final fallback: parse the config as text
      return parseConfigFromText(configPath);
    }
  }
}

// Parse config from text content (fallback method)
function parseConfigFromText(configPath) {
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    
    // Remove export statement and evaluate the config object
    const cleanContent = configContent
      .replace(/export\s*{\s*config\s*};?\s*$/m, '')
      .replace(/export\s+{\s*config\s*};?\s*$/m, '');
    
    // Create a safe evaluation context
    const config = {};
    
    // Use Function constructor to safely evaluate the config
    // This creates an isolated scope
    const configFunction = new Function('return (' + cleanContent.replace(/const config = /, '') + ')');
    const evaluatedConfig = configFunction();
    
    console.log('Successfully parsed USB config using text parsing');
    return evaluatedConfig;
  } catch (parseError) {
    console.error('Failed to parse config file:', parseError.message);
    throw new Error(`Unable to load config from ${configPath}. Please check the file format.`);
  }
}