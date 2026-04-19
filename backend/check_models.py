import google.generativeai as genai

# PASTE YOUR KEY HERE
api_key = "AIzaSyC9BBkj1oTIl6BSnP5P-J0I2CzESMT3bz0"
genai.configure(api_key=api_key)

print("Checking available models...")
try:
    # List all models
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f"FOUND: {m.name}")
except Exception as e:
    print(f"Error: {e}")