import os
from huggingface_hub import InferenceClient
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HF_TOKEN")
client = InferenceClient(api_key=token)

try:
    resp = client.chat_completion(
        model="meta-llama/Llama-3.3-70B-Instruct",
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=10
    )
    print("SUCCESS:", resp.choices[0].message.content)
except Exception as e:
    print("FAILURE:", e)
