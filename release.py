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
        
        # Buttons
        btn_frame = ttk.Frame(root)
        btn_frame.pack(pady=25)
        
        ttk.Button(btn_frame, text="🚀 Release", command=self.release).pack(side=tk.LEFT, padx=10)
        ttk.Button(btn_frame, text="❌ Cancel", command=root.quit).pack(side=tk.LEFT, padx=10)
        
        # Status
        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(root, textvariable=self.status_var, foreground='gray').pack(pady=10)
    
    def update_msg(self, *args):
        self.msg_var.set(f"Release v{self.version_var.get()}")
    
    def release(self):
        version = self.version_var.get()
        msg = self.msg_var.get()
        
        if not version or not msg:
            messagebox.showerror("Error", "Version and message are required!")
            return
        
        if not messagebox.askyesno("Confirm Release", 
            f"This will:\n\n"
            f"1. Update version to {version}\n"
            f"2. Commit: {msg}\n"
            f"3. Create tag v{version}\n"
            f"4. Push to GitHub\n\n"
            f"Continue?"):
            return
        
        self.status_var.set("Updating version...")
        self.root.update()
        
        try:
            update_version(version)
            self.status_var.set("Pushing to GitHub...")
            self.root.update()
            
            success, message = run_git_commands(version, msg)
            
            if success:
                messagebox.showinfo("Success", message + "\n\nGo to GitHub to publish the release!")
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
