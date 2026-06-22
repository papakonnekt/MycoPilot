# Remote Access Architecture & Deployment Guide

This guide details how to configure secure remote access to the containerized Myco Lab scheduler on an Android device (e.g., Samsung Galaxy S24 Ultra) using Tailscale, and how to compile the Capacitor Android app to connect to the backend server seamlessly.

---

## 1. Remote Access Architecture

To access the server remotely without exposing ports to the public internet, we utilize **Tailscale**, a zero-config virtual private mesh network based on WireGuard.

```
       +-------------------------------------------------------+
       |                  Private Tailnet Mesh                 |
       |                                                       |
  +----+----+ [100.x.y.z]                             +----+----+
  | Host PC | <=====================================> |   S24   |
  | (Docker |          Secure Encrypted Tunnel        |  Ultra  |
  |  Port   |                                         | (Client |
  |  3001)  |                                         |   App)  |
  +---------+                                         +---------+
```

### Key Benefits
- **No Port Forwarding**: Ports do not need to be opened on your router.
- **Secure Encrypted Tunneling**: All network packets are fully encrypted and transmitted directly peer-to-peer when possible.
- **Stable Network Identity**: Tailscale assigns a static private IP (within the `100.64.0.0/10` range) and a MagicDNS machine name to each device that remains identical across networks.

---

## 2. Tailscale Mesh Configuration

Follow these steps to connect your host PC and your Samsung S24 Ultra to your private Tailnet:

### Step 1: Set up the Host PC
1. Download and install [Tailscale for Windows](https://tailscale.com/download/windows) (or your host OS).
2. Launch the application and sign in using your preferred authentication provider.
3. Open the Tailscale Admin Console or click the Tailscale icon in the system tray to copy your machine's **Tailscale IP address** (e.g., `100.75.12.34`) or its **MagicDNS hostname** (e.g., `myco-host.tail-net.ts.net`).
4. Ensure your Myco Lab Docker container is running:
   ```bash
   docker compose up -d
   ```
   *Note: The container maps port `3001` on all host interfaces (`0.0.0.0:3001` by default), meaning it automatically listens on the Tailscale interface.*

### Step 2: Set up the Android Client (S24 Ultra)
1. Install **Tailscale** from the Google Play Store on your S24 Ultra.
2. Sign in to the same Tailscale account used for the host PC.
3. Toggle the VPN switch in the app to **Connected**.
4. To verify connection, open a web browser on the S24 Ultra and navigate to:
   `http://[Host-Tailscale-IP]:3001` (e.g., `http://100.75.12.34:3001`) or `http://[Host-MagicDNS]:3001`.
   The web application should load and resolve data successfully.

---

## 3. Capacitor Android App (APK) Compilation & Setup

Because native mobile wrappers serve web assets from a local web server (`http://localhost` origin on the device), relative API paths like `/api` fail. The application must be compiled with a hardcoded `VITE_API_BASE` pointing to the host PC's Tailscale connection.

### Step-by-Step CI/CD Configuration

1. **Add GitHub Repository Secret**:
   - Go to your private repository on GitHub: `papakonnekt/myco-operations`.
   - Navigate to **Settings** > **Secrets and variables** > **Actions**.
   - Click **New repository secret**.
   - **Name**: `VITE_API_BASE`
   - **Value**: `http://[Your-Host-Tailscale-IP]:3001/api` (or `http://[Your-Host-MagicDNS]:3001/api`).
     > [!IMPORTANT]
     > You must use the stable `100.x.y.z` Tailscale IP or MagicDNS machine name. Do not use `localhost` or local network IPs (like `192.168.x.x`), as the S24 Ultra will not be able to resolve them when you leave your home Wi-Fi network.

2. **Trigger the Compilation**:
   - Tag the codebase with a version tag starting with `v` (e.g., `v1.0.0`) and push it:
     ```bash
     git tag v1.0.0
     git push origin v1.0.0
     ```
   - Pushing the tag triggers the `.github/workflows/build-apk.yml` pipeline.

3. **Install the APK**:
   - Once the action completes (visible in the **Actions** tab), navigate to the **Releases** section.
   - Download the attached `MycoScheduler.apk` asset.
   - Transfer and install the APK on your S24 Ultra. (You may need to allow installation from unknown sources in Android settings).
   - Ensure the Tailscale VPN is **Connected** on your S24 Ultra, then open the **MycoScheduler** app!

---

## 4. Troubleshooting & Network Customizations

### Cleartext Traffic Policies
Starting with Android 9 (API Level 28), cleartext (HTTP) connections are blocked by default. Because Tailscale connections are typically routed using HTTP over the secure VPN tunnel, we have pre-configured the Android application wrapper to allow HTTP traffic by setting:
```xml
android:usesCleartextTraffic="true"
```
inside the `<application>` tag of `client/android/app/src/main/AndroidManifest.xml`. If you face connection issues, double check that this file is present and built.

### Tailscale Access Control Lists (ACLs)
If you configure strict access rules in Tailscale, ensure that your client device is allowed to communicate with the host PC on port `3001`. Default Tailscale configurations allow all devices in your tailnet to connect to one another.
