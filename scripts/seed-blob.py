import sys
from pathlib import Path

# Add repo root and agent/ to sys.path
root = Path(__file__).parent.parent
sys.path.append(str(root / "agent"))

from dotenv import load_dotenv
load_dotenv(root / ".env")

from blob_sync import upload_brain

if __name__ == "__main__":
    print("Seeding local brain files into Vercel Blob...")
    upload_brain()
    print("Seeding complete!")
