import os
import httpx
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_TOKEN")

url = "https://api-inference.huggingface.co/models/meta-llama/Llama-3.3-70B-Instruct/v1/chat/completions"
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}
payload = {
    "model": "meta-llama/Llama-3.3-70B-Instruct",
    "messages": [{"role": "user", "content": "hi"}],
    "max_tokens": 10
}

try:
    with httpx.Client() as client:
        resp = client.post(url, headers=headers, json=payload)
        print("STATUS:", resp.status_code)
        if resp.status_code == 200:
            print("SUCCESS:", resp.json()["choices"][0]["message"]["content"])
        else:
            print("ERROR:", resp.text)
except Exception as e:
    print("FAILURE:", e)
