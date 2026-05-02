import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

try:
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=10
    )
    print("SUCCESS:", resp.choices[0].message.content)
except Exception as e:
    print("FAILURE:", e)
