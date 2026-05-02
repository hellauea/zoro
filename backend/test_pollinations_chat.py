import httpx

url = "https://text.pollinations.ai/openai/chat/completions"
payload = {
    "model": "openai",
    "messages": [{"role": "user", "content": "hi"}],
    "max_tokens": 10
}

try:
    with httpx.Client() as client:
        resp = client.post(url, json=payload)
        print("STATUS:", resp.status_code)
        print("SUCCESS:", resp.json()["choices"][0]["message"]["content"])
except Exception as e:
    print("FAILURE:", e)
