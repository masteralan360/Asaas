import os
import json
import base64
import requests
import glob
from pathlib import Path
from datetime import datetime
import re

def r2_request(method, path, data=None, content_type=None):
    worker_url = os.environ.get("VITE_R2_WORKER_URL")
    auth_token = os.environ.get("VITE_R2_AUTH_TOKEN")
    
    if not worker_url or not auth_token:
        print("Error: R2 environment variables missing")
        exit(1)
        
    baseUrl = worker_url if worker_url.endswith('/') else f"{worker_url}/"
    url = f"{baseUrl}{path}"
    
    headers = {
        "Authorization": f"Bearer {auth_token}"
    }
    if content_type:
        headers["Content-Type"] = content_type
        
    response = requests.request(method, url, headers=headers, data=data)
    if not response.ok and method != "DELETE":
        print(f"R2 Request Failed: {response.status_code} {response.text}")
        exit(1)
    return response

def clear_updates():
    print("Clearing asaas-updates/ in R2...")
    worker_url = os.environ.get("VITE_R2_WORKER_URL")
    auth_token = os.environ.get("VITE_R2_AUTH_TOKEN")
    
    if not worker_url or not auth_token:
        print("Error: R2 environment variables missing")
        return

    baseUrl = worker_url if worker_url.endswith('/') else f"{worker_url}/"
    list_url = f"{baseUrl}?list=1&prefix=asaas-updates/"
    
    headers = {"Authorization": f"Bearer {auth_token}"}
    response = requests.get(list_url, headers=headers)
    
    if response.ok:
        data = response.json()
        keys = data.get("keys", [])
        for key in keys:
            print(f"Deleting {key}...")
            r2_request("DELETE", key)
    else:
        print(f"Skip clearing: List failed (maybe empty or check worker)")

def upload_assets():
    print("Starting asset upload to R2...")
    # Broaden patterns to find assets wherever they might be in the bundle dir
    windows_patterns = [
        "src-tauri/target/release/bundle/msi/*.msi",
        "src-tauri/target/release/bundle/msi/*.msi.sig",
        "src-tauri/target/release/bundle/nsis/*.exe",
        "src-tauri/target/release/bundle/nsis/*.exe.sig",
        "src-tauri/target/release/bundle/updater/latest.json",
        "src-tauri/target/release/bundle/latest.json",
        "**/target/release/bundle/updater/latest.json"
    ]
    
    # Find Android assets
    android_patterns = [
        "src-tauri/gen/android/app/build/outputs/apk/universal/release/Asaas-Release-Signed.apk",
        "src-tauri/gen/android/app/build/outputs/apk/debug/*.apk",
        "**/outputs/apk/**/Asaas-Release-Signed.apk"
    ]
    
    all_files = []
    print("Searching for files using patterns...")
    for p in windows_patterns + android_patterns:
        matches = glob.glob(p, recursive=True)
        if matches:
            print(f"Pattern '{p}' matched: {matches}")
        all_files.extend(matches)
        
    if not all_files:
        print("No assets found to upload!")
        return

    # Process latest.json if found (look for the most relevant one)
    latest_json_path = None
    for f_path in all_files:
        if os.path.basename(f_path) == "latest.json":
            latest_json_path = f_path
            # Prefer the one in 'updater' dir if multiple exist
            if "/updater/" in f_path:
                break
    
    if latest_json_path and os.path.exists(latest_json_path):
        print(f"Processing {latest_json_path} for R2 URLs...")
        with open(latest_json_path, 'r') as f:
            data = json.load(f)
            
        worker_url = os.environ.get("VITE_R2_WORKER_URL")
        if not worker_url:
            print("Error: VITE_R2_WORKER_URL missing for latest.json processing")
            exit(1)
            
        baseUrl = worker_url if worker_url.endswith('/') else f"{worker_url}/"
        
        # Replace URLs in platforms
        for platform, details in data.get("platforms", {}).items():
            if "url" in details:
                filename = os.path.basename(details["url"])
                details["url"] = f"{baseUrl}asaas-updates/{filename}"
                print(f"Updated {platform} URL to R2")
                
        with open(latest_json_path, 'w') as f:
            json.dump(data, f, indent=2)
    else:
        print("latest.json not found on disk. Generating it dynamically from artifacts...")
        # Get version from tauri.conf.json
        version = "0.0.0"
        try:
            with open("src-tauri/tauri.conf.json", 'r') as f:
                tauri_conf = json.load(f)
                version = tauri_conf.get("version", "0.0.0")
        except Exception as e:
            print(f"Warning: Could not read version from tauri.conf.json: {e}")

        worker_url = os.environ.get("VITE_R2_WORKER_URL")
        baseUrl = worker_url if worker_url.endswith('/') else f"{worker_url}/"
        
        data = {
            "version": version,
            "notes": f"Release {version}",
            "pub_date": datetime.utcnow().isoformat() + "Z",
            "platforms": {}
        }
        
        # Map artifacts to platforms
        # We look for .msi (primary) or .exe for windows-x86_64
        windows_bin = None
        for f_path in all_files:
            if f_path.endswith(".msi"):
                windows_bin = f_path
                break
            elif f_path.endswith(".exe") and not windows_bin:
                windows_bin = f_path
        
        if windows_bin:
            sig_path = f"{windows_bin}.sig"
            signature = ""
            if os.path.exists(sig_path):
                try:
                    with open(sig_path, 'r') as f:
                        signature = f.read().strip()
                except Exception as e:
                    print(f"Warning: Could not read signature {sig_path}: {e}")
            
            filename = os.path.basename(windows_bin)
            data["platforms"]["windows-x86_64"] = {
                "signature": signature,
                "url": f"{baseUrl}asaas-updates/{filename}"
            }
            print(f"Dynamically mapped windows-x86_64 to {filename}")

        # Write generated JSON
        latest_json_path = "latest.json"
        with open(latest_json_path, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"Generated {latest_json_path}")
        all_files.append(latest_json_path)

    # Upload all
    for file_path in all_files:
        filename = os.path.basename(file_path)
        r2_path = f"asaas-updates/{filename}"
        print(f"Uploading {file_path} to {r2_path}...")
        
        content_type = "application/json" if filename.endswith(".json") else "application/octet-stream"
        if filename.endswith(".msi"): content_type = "application/x-msi"
        elif filename.endswith(".exe"): content_type = "application/x-msdos-program"
        elif filename.endswith(".apk"): content_type = "application/vnd.android.package-archive"
        
        with open(file_path, 'rb') as f:
            r2_request("PUT", r2_path, data=f, content_type=content_type)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "clear":
        clear_updates()
    else:
        upload_assets()
