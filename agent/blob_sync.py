import os
import urllib.request
import json
from pathlib import Path
import vercelpy.blob_store as blob_store

BRAIN_DIR = Path(__file__).parent.parent / "brain"

def download_brain():
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
    if not token:
        print("BLOB_READ_WRITE_TOKEN not set, skipping download")
        return
        
    try:
        print("Syncing brain down from Vercel Blob...")
        res = blob_store.list({"token": token, "limit": 1000})
        blobs = res.get("blobs", [])
        
        count = 0
        for b in blobs:
            pathname = b.get("pathname", "")
            # Only download .md files under brain/
            if pathname.startswith("brain/") and pathname.endswith(".md"):
                url = b.get("downloadUrl")
                dest = BRAIN_DIR.parent / pathname
                dest.parent.mkdir(parents=True, exist_ok=True)
                
                # Fetch content
                with urllib.request.urlopen(url) as response:
                    content = response.read()
                    dest.write_bytes(content)
                count += 1
                
        print(f"Successfully downloaded {count} files from Vercel Blob to {BRAIN_DIR}")
    except Exception as e:
        print("Failed to download brain from Vercel Blob:", e)

def upload_brain():
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
    if not token:
        print("BLOB_READ_WRITE_TOKEN not set, skipping upload")
        return
        
    try:
        print("Syncing brain up to Vercel Blob...")
        if not BRAIN_DIR.exists():
            print("No local brain directory to upload")
            return
            
        count = 0
        for root, dirs, files in os.walk(BRAIN_DIR):
            for file in files:
                if file.endswith(".md"):
                    full_path = Path(root) / file
                    relative_path = full_path.relative_to(BRAIN_DIR.parent)
                    pathname = str(relative_path).replace("\\", "/") # normalize path separators
                    
                    with open(full_path, "rb") as f:
                        data = f.read()
                        
                    # Upload
                    blob_store.put(
                        pathname, 
                        data, 
                        options={
                            "token": token,
                            "addRandomSuffix": "false",
                            "allowOverwrite": "true"
                        }
                    )
                    count += 1
                    
        print(f"Successfully uploaded {count} files to Vercel Blob")
    except Exception as e:
        print("Failed to upload brain to Vercel Blob:", e)
