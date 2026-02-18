import requests

TOKEN = "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"
REPO = "masteralan360/Asaas"
headers = {"Authorization": f"token {TOKEN}"}

# Get all releases
releases_url = f"https://api.github.com/repos/{REPO}/releases"
releases = requests.get(releases_url, headers=headers).json()

for release in releases:
    delete_url = release["url"]
    response = requests.delete(delete_url, headers=headers)
    print(f"Deleted {release['tag_name']}: {response.status_code}")