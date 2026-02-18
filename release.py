"""
Asaas Release Helper
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


def is_git_clean():
    """Check if there are any uncommitted changes"""
    try:
        result = subprocess.run(['git', 'status', '--porcelain'], cwd=SCRIPT_DIR, capture_output=True, text=True, check=True)
        return len(result.stdout.strip()) == 0
    except subprocess.CalledProcessError:
        return False


def run_git_commands(version, commit_msg):
    """Run git commands to commit and push tag"""
    tag = f"v{version}"
    
    try:
        print(f"--- Starting Release {tag} ---")
        
        # Stage all changes
        print("Staging changes...")
        subprocess.run(['git', 'add', '.'], cwd=SCRIPT_DIR, check=True)
        
        # Commit
        print(f"Committing with message: {commit_msg}")
        subprocess.run(['git', 'commit', '-m', commit_msg], cwd=SCRIPT_DIR, check=True)
        
        # Push to main
        print("Pushing to origin main...")
        subprocess.run(['git', 'push', 'origin', 'main'], cwd=SCRIPT_DIR, check=True)
        
        # Create tag
        print(f"Creating tag {tag}...")
        subprocess.run(['git', 'tag', tag], cwd=SCRIPT_DIR, check=True)
        
        # Push tag
        print(f"Pushing tag {tag} to origin...")
        subprocess.run(['git', 'push', 'origin', tag], cwd=SCRIPT_DIR, check=True)
        
        print(f"--- Successfully released {tag} ---")
        return True, f"Successfully released {tag}!"
    except subprocess.CalledProcessError as e:
        error_msg = f"Git error: {e}"
        print(f"❌ {error_msg}")
        return False, error_msg


class ReleaseApp:
    def __init__(self, root):
        self.root = root
        root.title("Asaas Release Helper")
        root.geometry("400x450")
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
        
        # Buttons
        btn_frame = ttk.Frame(root)
        btn_frame.pack(pady=10)
        
        ttk.Button(btn_frame, text="🚀 Release", command=self.release).pack(side=tk.LEFT, padx=10)
        ttk.Button(btn_frame, text="❌ Cancel", command=root.quit).pack(side=tk.LEFT, padx=10)
        
        # Status
        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(root, textvariable=self.status_var, foreground='gray').pack(pady=5)
        
        # Local Build Section (Separated from Release)
        ttk.Separator(root, orient='horizontal').pack(fill='x', padx=20, pady=10)
        
        ttk.Label(root, text="Local Development Tools", font=('Segoe UI', 9, 'bold')).pack()
        
        local_btn_frame = ttk.Frame(root)
        local_btn_frame.pack(pady=5)
        
        ttk.Button(local_btn_frame, text="�️ Build Local APK", command=self.build_apk_local_cmd).pack(padx=10)
        
        ttk.Label(root, text="(Use this only to test the APK on your phone manually)", 
                  foreground='#666666', font=('Segoe UI', 8, 'italic')).pack()

    def update_msg(self, *args):
        self.msg_var.set(f"Release v{self.version_var.get()}")
    
    def build_apk_local_cmd(self):
        """Dedicated command for local build button"""
        if not messagebox.askyesno("Confirm Local Build", 
            "This will build the APK on your computer (takes a few minutes).\n\n"
            "Note: GitHub already builds this automatically during release.\n\n"
            "Continue?"):
            return
            
        success, message = self.build_apk()
        if success:
            messagebox.showinfo("Success", message)
        else:
            messagebox.showerror("Error", message)
        self.status_var.set("Ready")

    def build_apk(self):
        """Run android build and rename APK"""
        try:
            self.status_var.set("Building Local Android APK...")
            self.root.update()
            
            # Run npm run android:build (tauri android build --debug)
            # This version is AUTOMATICALLY SIGNED and can be installed on phones immediately.
            subprocess.run(['npm.cmd', 'run', 'android:build'], cwd=SCRIPT_DIR, check=True, shell=True)
            
            # Potential Tauri APK output paths
            potential_paths = [
                SCRIPT_DIR / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs" / "apk" / "universal" / "release" / "app-universal-release-unsigned.apk",
                SCRIPT_DIR / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release-unsigned.apk",
                SCRIPT_DIR / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
            ]
            
            apk_path = None
            for p in potential_paths:
                if p.exists():
                    apk_path = p
                    break
            
            output_apk = SCRIPT_DIR / "Asaas.apk"
            
            if apk_path:
                import shutil
                shutil.copy2(apk_path, output_apk)
                self.status_var.set("Ready")
                return True, "APK built and renamed to Asaas.apk"
            else:
                self.status_var.set("Failed")
                return False, f"APK not found at {apk_path}"
                
        except subprocess.CalledProcessError as e:
            self.status_var.set("Failed")
            return False, f"Build error: {e}"
        except Exception as e:
            self.status_var.set("Failed")
            return False, f"Unexpected error: {e}"

    def release(self):
        # Sanitize version (remove leading 'v')
        version = self.version_var.get().strip()
        if version.lower().startswith('v'):
            version = version[1:]
            
        msg = self.msg_var.get()
        
        if not version or not msg:
            messagebox.showerror("Error", "Version and message are required!")
            return
        
        # Pre-flight check
        if not is_git_clean():
            if not messagebox.askyesno("Uncommitted Changes", 
                "You have uncommitted changes in your repository.\n\n" +
                "These will be included in the release commit automatically.\n" +
                "Continue?"):
                return

        steps = [
            f"1. Update version to {version}",
            f"2. Commit: {msg}",
            f"3. Create tag v{version}",
            f"4. Push to GitHub (Triggers Auto-Releases)"
        ]
            
        if not messagebox.askyesno("Confirm Release", 
            "This will start the GitHub release process:\n\n" + "\n".join(steps) + "\n\nContinue?"):
            return
        
        self.status_var.set("Updating version...")
        self.root.update()
        
        try:
            update_version(version)
            
            self.status_var.set("Pushing to GitHub...")
            self.root.update()
            
            success, message = run_git_commands(version, msg)
            
            if success:
                messagebox.showinfo("Success", message + "\n\nGitHub will now build both Windows and Android versions automatically!")
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
