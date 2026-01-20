"""
IraqCore Release Helper
A simple GUI to automate version bumping and release tagging.
Run with: python release.py
"""

import json
import subprocess
import tkinter as tk
from tkinter import messagebox, ttk
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
TAURI_CONF = SCRIPT_DIR / "src-tauri" / "tauri.conf.json"
PACKAGE_JSON = SCRIPT_DIR / "package.json"


def read_version():
    """Read current version from tauri.conf.json"""
    with open(TAURI_CONF, 'r') as f:
        data = json.load(f)
    return data.get('version', '1.0.0')


def increment_version(version):
    """Increment patch version (1.0.14 -> 1.0.15)"""
    parts = version.split('.')
    parts[-1] = str(int(parts[-1]) + 1)
    return '.'.join(parts)


def update_version(new_version):
    """Update version in both config files"""
    # Update tauri.conf.json
    with open(TAURI_CONF, 'r') as f:
        tauri_data = json.load(f)
    tauri_data['version'] = new_version
    with open(TAURI_CONF, 'w') as f:
        json.dump(tauri_data, f, indent=2)
    
    # Update package.json
    with open(PACKAGE_JSON, 'r') as f:
        pkg_data = json.load(f)
    pkg_data['version'] = new_version
    with open(PACKAGE_JSON, 'w') as f:
        json.dump(pkg_data, f, indent=2)


def run_git_commands(version, commit_msg):
    """Run git commands to commit and push tag"""
    tag = f"v{version}"
    
    try:
        # Stage all changes
        subprocess.run(['git', 'add', '.'], cwd=SCRIPT_DIR, check=True)
        
        # Commit
        subprocess.run(['git', 'commit', '-m', commit_msg], cwd=SCRIPT_DIR, check=True)
        
        # Push to main
        subprocess.run(['git', 'push', 'origin', 'main'], cwd=SCRIPT_DIR, check=True)
        
        # Create tag
        subprocess.run(['git', 'tag', tag], cwd=SCRIPT_DIR, check=True)
        
        # Push tag
        subprocess.run(['git', 'push', 'origin', tag], cwd=SCRIPT_DIR, check=True)
        
        return True, f"Successfully released {tag}!"
    except subprocess.CalledProcessError as e:
        return False, f"Git error: {e}"


class ReleaseApp:
    def __init__(self, root):
        self.root = root
        root.title("IraqCore Release Helper")
        root.geometry("400x300")
        root.resizable(False, False)
        
        # Style
        style = ttk.Style()
        style.configure('TLabel', font=('Segoe UI', 10))
        style.configure('TButton', font=('Segoe UI', 10))
        style.configure('Header.TLabel', font=('Segoe UI', 14, 'bold'))
        
        # Header
        ttk.Label(root, text="🚀 Release Helper", style='Header.TLabel').pack(pady=15)
        
        # Current version
        current = read_version()
        ttk.Label(root, text=f"Current Version: {current}").pack()
        
        # New version
        frame = ttk.Frame(root)
        frame.pack(pady=15)
        ttk.Label(frame, text="New Version:").pack(side=tk.LEFT, padx=5)
        self.version_var = tk.StringVar(value=increment_version(current))
        self.version_entry = ttk.Entry(frame, textvariable=self.version_var, width=15)
        self.version_entry.pack(side=tk.LEFT)
        
        # Commit message
        ttk.Label(root, text="Commit Message:").pack(pady=(10, 5))
        self.msg_var = tk.StringVar(value=f"Release v{increment_version(current)}")
        self.msg_entry = ttk.Entry(root, textvariable=self.msg_var, width=40)
        self.msg_entry.pack()
        
        # Update message when version changes
        self.version_var.trace('w', self.update_msg)
        
        # APK Release Options
        self.apk_var = tk.BooleanVar(value=True)
        self.apk_check = ttk.Checkbutton(root, text="Step 5: Release APK (IraqCore)", variable=self.apk_var)
        self.apk_check.pack(pady=5)
        
        self.skip_build_var = tk.BooleanVar(value=False)
        self.skip_build_check = ttk.Checkbutton(root, text="   └─ Skip Build (Use Existing)", variable=self.skip_build_var)
        self.skip_build_check.pack(pady=2)
        
        # Buttons
        btn_frame = ttk.Frame(root)
        btn_frame.pack(pady=15)
        
        ttk.Button(btn_frame, text="🚀 Release", command=self.release).pack(side=tk.LEFT, padx=10)
        ttk.Button(btn_frame, text="❌ Cancel", command=root.quit).pack(side=tk.LEFT, padx=10)
        
        # Status
        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(root, textvariable=self.status_var, foreground='gray').pack(pady=5)
    
    def update_msg(self, *args):
        self.msg_var.set(f"Release v{self.version_var.get()}")
    
    def find_and_rename_apk(self):
        """Locate generated APK and rename to IraqCore.apk"""
        # Potential Tauri APK output paths
        potential_paths = [
            # Universal Release (User's actual path)
            SCRIPT_DIR / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs" / "apk" / "universal" / "release" / "app-universal-release-unsigned.apk",
            # Standard Release
            SCRIPT_DIR / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release-unsigned.apk",
            # Standard Debug
            SCRIPT_DIR / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
        ]
        
        apk_path = None
        for p in potential_paths:
            if p.exists():
                apk_path = p
                break
        
        output_apk = SCRIPT_DIR / "IraqCore.apk"
        
        if apk_path:
            import shutil
            shutil.copy2(apk_path, output_apk)
            return True, f"Found APK at {apk_path.name} and renamed to IraqCore.apk"
        else:
            return False, "No APK found in build folders. Please build the APK first."

    def build_apk(self):
        """Run android build"""
        try:
            self.status_var.set("Building Android APK (Release)...")
            self.root.update()
            
            # Run npm run android:build:release (tauri android build)
            subprocess.run(['npm.cmd', 'run', 'android:build:release'], cwd=SCRIPT_DIR, check=True, shell=True)
            return True, "Build successful"
                
        except subprocess.CalledProcessError as e:
            return False, f"Build error: {e}"
        except Exception as e:
            return False, f"Unexpected error: {e}"

    def release(self):
        version = self.version_var.get()
        msg = self.msg_var.get()
        release_apk = self.apk_var.get()
        skip_build = self.skip_build_var.get()
        
        if not version or not msg:
            messagebox.showerror("Error", "Version and message are required!")
            return
        
        steps = [
            f"1. Update version to {version}",
            f"2. Commit: {msg}",
            f"3. Create tag v{version}",
            f"4. Push to GitHub"
        ]
        if release_apk:
            action = "Rename" if skip_build else "Build & Release"
            steps.append(f"5. {action} IraqCore.apk")
            
        if not messagebox.askyesno("Confirm Release", 
            "This will:\n\n" + "\n".join(steps) + "\n\nContinue?"):
            return
        
        self.status_var.set("Updating version...")
        self.root.update()
        
        try:
            update_version(version)
            
            if release_apk:
                if not skip_build:
                    success, message = self.build_apk()
                    if not success:
                        if not messagebox.askyesno("Build Failed", f"{message}\n\nContinue with Git release anyway?"):
                            return
                
                # Copy/Rename logic (always run if release_apk is checked)
                success, message = self.find_and_rename_apk()
                if not success:
                    if not messagebox.askyesno("APK Error", f"{message}\n\nContinue with Git release anyway?"):
                        return
            
            self.status_var.set("Pushing to GitHub...")
            self.root.update()
            
            success, message = run_git_commands(version, msg)
            
            if success:
                apk_msg = "\n\nIraqCore.apk is ready!" if release_apk else ""
                messagebox.showinfo("Success", message + apk_msg + "\n\nGo to GitHub to publish the release!")
                self.root.quit()
            else:
                messagebox.showerror("Error", message)
                self.status_var.set("Failed")
        except Exception as e:
            messagebox.showerror("Error", str(e))
            self.status_var.set("Failed")


if __name__ == "__main__":
    root = tk.Tk()
    app = ReleaseApp(root)
    root.mainloop()
