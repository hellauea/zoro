import os
import httpx
from dotenv import load_dotenv

load_dotenv()
key = os.getenv("TOGETHER_API_KEY")

url = "https://api.together.xyz/v1/chat/completions"
headers = {
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}
payload = {
    "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "messages": [{"role": "user", "content": "hi"}],
    "max_tokens": 10
}

try:
    with httpx.Client() as client:
        resp = client.post(url, headers=headers, json=payload)
        print("STATUS:", resp.status_code)
        print("SUCCESS:", resp.json()["choices"][0]["message"]["content"])
except Exception as e:
    print("FAILURE:", e)
