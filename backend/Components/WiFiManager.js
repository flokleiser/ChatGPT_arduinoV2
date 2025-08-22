import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class WiFiManager {
  constructor() {
    this.connectionName = 'auto-connect-wifi';
  }

  /**
   * Check if WiFi is connected (not just enabled) - improved to distinguish from Ethernet
   */
  async isConnected() {
    try {
      // Check if there's an active WiFi connection specifically
      const { stdout } = await execAsync('nmcli -t -f TYPE,STATE connection show --active');
      const lines = stdout.trim().split('\n');
      const wifiConnected = lines.some(line => 
        line.startsWith('802-11-wireless:') && line.includes(':activated')
      );
      
      return wifiConnected;
    } catch (error) {
      console.error('Error checking WiFi status:', error.message);
      return false;
    }
  }

  /**
   * Get current WiFi connection status - improved to exclude Ethernet
   */
  async getConnectionStatus() {
    try {
      // Get only WiFi connections
      const { stdout } = await execAsync('nmcli -t -f NAME,TYPE,STATE connection show --active');
      const lines = stdout.trim().split('\n');
      const activeWiFiConnections = lines
        .filter(line => line.includes(':802-11-wireless:activated'))
        .map(line => line.split(':')[0]);
      
      return {
        connected: activeWiFiConnections.length > 0,
        activeConnections: activeWiFiConnections
      };
    } catch (error) {
      console.error('Error getting connection status:', error.message);
      return { connected: false, activeConnections: [] };
    }
  }

  /**
   * Connect to a regular WPA2/WPA3 network
   */
  async connectToWPA(ssid, password) {
    try {
      console.log(`Attempting to connect to WPA network: ${ssid}`);
      
      // Remove existing connection with same name if it exists
      await this.removeConnection(this.connectionName);
      
      const command = `nmcli connection add con-name "${this.connectionName}" type wifi ifname wlan0 ssid "${ssid}" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${password}" ipv4.method auto connection.autoconnect yes`;
      
      await execAsync(command);
      console.log(`WiFi profile created for ${ssid}`);
      
      // Attempt to connect
      await execAsync(`nmcli connection up "${this.connectionName}"`);
      console.log(`Successfully connected to ${ssid}`);
      
      return { success: true, message: `Connected to ${ssid}` };
    } catch (error) {
      console.error('Error connecting to WPA network:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Connect to WPA2 Enterprise network
   */
  async connectToWPA2Enterprise(ssid, username, password) {
    try {
      console.log(`Attempting to connect to WPA2 Enterprise network: ${ssid}`);
      
      // Remove existing connection with same name if it exists
      await this.removeConnection(this.connectionName);
      
      const command = `nmcli connection add con-name "${this.connectionName}" type wifi ifname wlan0 ssid "${ssid}" wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2 802-1x.identity "${username}" 802-1x.password "${password}" ipv4.method auto connection.autoconnect yes`;
      
      await execAsync(command);
      console.log(`WiFi Enterprise profile created for ${ssid}`);
      
      // Attempt to connect
      await execAsync(`nmcli connection up "${this.connectionName}"`);
      console.log(`Successfully connected to ${ssid}`);
      
      return { success: true, message: `Connected to ${ssid}` };
    } catch (error) {
      console.error('Error connecting to WPA2 Enterprise network:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Connect to open network (no password)
   */
  async connectToOpen(ssid) {
    try {
      console.log(`Attempting to connect to open network: ${ssid}`);
      
      // Remove existing connection with same name if it exists
      await this.removeConnection(this.connectionName);
      
      const command = `nmcli connection add con-name "${this.connectionName}" type wifi ifname wlan0 ssid "${ssid}" ipv4.method auto connection.autoconnect yes`;
      
      await execAsync(command);
      console.log(`WiFi profile created for ${ssid}`);
      
      // Attempt to connect
      await execAsync(`nmcli connection up "${this.connectionName}"`);
      console.log(`Successfully connected to ${ssid}`);
      
      return { success: true, message: `Connected to ${ssid}` };
    } catch (error) {
      console.error('Error connecting to open network:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Remove existing connection
   */
  async removeConnection(connectionName) {
    try {
      await execAsync(`nmcli connection delete "${connectionName}"`);
      console.log(`Removed existing connection: ${connectionName}`);
    } catch (error) {
      // Connection might not exist, which is fine
      console.log(`No existing connection to remove: ${connectionName}`);
    }
  }

  /**
   * Auto-detect network type and connect based on config WiFi settings
   */
  async connectFromConfig(wifiConfig) {
    if (!wifiConfig || !wifiConfig.ssid) {
      console.log('No WiFi configuration found in config');
      return { success: false, message: 'No WiFi configuration provided' };
    }

    const { ssid, password, username } = wifiConfig;
    console.log(`WiFi config found - SSID: ${ssid}`);

    try {
      // Auto-detect network type based on credentials and network scan
      let detectedType = await this.detectNetworkType(ssid, { password, username });
      console.log(`Auto-detected network type: ${detectedType}`);

      switch (detectedType) {
        case 'wpa2-enterprise':
          if (!username || !password) {
            throw new Error('Username and password required for WPA2 Enterprise');
          }
          return await this.connectToWPA2Enterprise(ssid, username, password);
          
        case 'wpa2':
        case 'wpa3':
        case 'wpa':
          if (!password) {
            throw new Error('Password required for WPA/WPA2/WPA3 networks');
          }
          return await this.connectToWPA(ssid, password);
          
        case 'open':
          return await this.connectToOpen(ssid);
          
        default:
          throw new Error(`Unable to determine network type for: ${ssid}`);
      }
    } catch (error) {
      console.error('Error connecting from config:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Auto-detect network type based on credentials and network scan
   */
  async detectNetworkType(ssid, credentials = {}) {
    const { password, username } = credentials;

    // Rule 1: If username is provided, it's definitely Enterprise
    if (username) {
      console.log('Username provided → WPA2-Enterprise');
      return 'wpa2-enterprise';
    }

    // Rule 2: If no password, assume open (but verify with scan)
    if (!password) {
      console.log('No password provided → checking if network is open');
      const networkInfo = await this.getNetworkSecurity(ssid);
      if (networkInfo && networkInfo.security.toLowerCase().includes('none')) {
        return 'open';
      } else {
        console.log('Network appears to be secured but no password provided');
        throw new Error('Network is secured but no password provided');
      }
    }

    // Rule 3: Password provided, scan to determine WPA type
    const networkInfo = await this.getNetworkSecurity(ssid);
    if (networkInfo) {
      const security = networkInfo.security.toLowerCase();
      console.log(`Network security detected: ${security}`);
      
      if (security.includes('wpa3')) {
        return 'wpa3';
      } else if (security.includes('wpa2') || security.includes('wpa')) {
        return 'wpa2';
      } else if (security.includes('none') || security === '') {
        return 'open';
      }
    }

    // Rule 4: Default fallback - if we have a password but can't determine type, assume WPA2
    console.log('Unable to detect specific type, defaulting to WPA2');
    return 'wpa2';
  }

  /**
   * Get security information for a specific network
   */
  async getNetworkSecurity(targetSSID) {
    try {
      const { stdout } = await execAsync('nmcli -t -f SSID,SECURITY dev wifi list');
      const lines = stdout.trim().split('\n');
      
      for (const line of lines) {
        const [ssid, security] = line.split(':');
        if (ssid === targetSSID) {
          return { ssid, security: security || 'none' };
        }
      }
      
      console.log(`Network ${targetSSID} not found in scan, will attempt connection anyway`);
      return null;
    } catch (error) {
      console.error('Error scanning for network security:', error.message);
      return null;
    }
  }

  /**
   * Scan for available networks
   */
  async scanNetworks() {
    try {
      const { stdout } = await execAsync('nmcli -t -f SSID,SECURITY dev wifi list');
      const networks = stdout.trim().split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const [ssid, security] = line.split(':');
          return { ssid: ssid || 'Hidden Network', security: security || 'Open' };
        })
        .filter((network, index, self) => 
          // Remove duplicates based on SSID
          index === self.findIndex(n => n.ssid === network.ssid)
        );
      
      return networks;
    } catch (error) {
      console.error('Error scanning networks:', error.message);
      return [];
    }
  }

  /**
   * Get current IP address and connection info - improved to distinguish WiFi from Ethernet
   */
  async getConnectionInfo() {
    try {
      // Get WiFi-specific info
      let wifiSSID = 'Not connected';
      let wifiIP = null;
      
      try {
        const { stdout: ssidInfo } = await execAsync('nmcli -t -f active,ssid dev wifi | grep "^yes:"');
        wifiSSID = ssidInfo.split(':')[1] || 'Not connected';
        
        // Get WiFi interface IP specifically
        const { stdout: wifiIPInfo } = await execAsync('ip addr show wlan0 | grep "inet " | awk \'{print $2}\' | cut -d/ -f1');
        wifiIP = wifiIPInfo.trim() || null;
      } catch (error) {
        console.log('No active WiFi connection found');
      }
      
      // Get general connection info (primary route)
      let primaryIP = 'Unknown';
      try {
        const { stdout } = await execAsync('ip route get 8.8.8.8');
        const match = stdout.match(/src (\S+)/);
        primaryIP = match ? match[1] : 'Unknown';
      } catch (error) {
        console.log('Unable to determine primary IP');
      }
      
      // Check if primary connection is via WiFi
      const connectedViaWiFi = wifiIP && (wifiIP === primaryIP);
      
      return {
        ip: wifiIP || primaryIP,
        ssid: wifiSSID,
        connected: !!wifiIP,
        connectedViaWiFi: connectedViaWiFi,
        wifiIP: wifiIP,
        primaryIP: primaryIP
      };
    } catch (error) {
      console.error('Error getting connection info:', error.message);
      return {
        ip: 'Unknown',
        ssid: 'Not connected',
        connected: false,
        connectedViaWiFi: false,
        wifiIP: null,
        primaryIP: 'Unknown'
      };
    }
  }

  /**
   * Test WiFi connectivity specifically (not Ethernet)
   */
  async testWiFiConnectivity() {
    try {
      // First check if WiFi is connected
      const connectionInfo = await this.getConnectionInfo();
      if (!connectionInfo.wifiIP) {
        return { success: false, message: 'WiFi not connected' };
      }
      
      // Test internet via WiFi interface specifically
      await execAsync('ping -c 1 -W 3 -I wlan0 8.8.8.8');
      return { success: true, message: 'WiFi internet connectivity confirmed' };
    } catch (error) {
      return { success: false, message: 'WiFi has no internet connectivity' };
    }
  }
}

export default WiFiManager;