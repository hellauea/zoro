import { useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";

export default function Login() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignUp) {
        if (!name.trim()) { setError("Name is required"); setLoading(false); return; }
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/user-not-found") setError("No account with that email");
      else if (code === "auth/wrong-password") setError("Wrong password");
      else if (code === "auth/invalid-credential") setError("Invalid email or password");
      else if (code === "auth/email-already-in-use") setError("Email already in use");
      else if (code === "auth/weak-password") setError("Password must be 6+ characters");
      else if (code === "auth/invalid-email") setError("Invalid email address");
      else setError("Something went wrong. Try again.");
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code !== "auth/popup-closed-by-user") {
        setError("Google sign-in failed. Try again.");
      }
    }
    setLoading(false);
  };

  return (
    <>
      <style>{css}</style>
      <div className="login-root">
        <motion.div
          className="login-card"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Logo */}
          <div className="login-brand">
            <div className="login-dot" />
            <span className="login-name">ZORO</span>
          </div>
          <p className="login-sub">
            {isSignUp ? "Create your account" : "Welcome back"}
          </p>

          {/* Google */}
          <button className="login-google" onClick={handleGoogle} disabled={loading}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <div className="login-divider">
            <span>or</span>
          </div>

          {/* Email form */}
          <form className="login-form" onSubmit={handleEmail}>
            {isSignUp && (
              <input
                className="login-input"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            )}
            <input
              className="login-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <input
              className="login-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
            {error && <p className="login-err">{error}</p>}
            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "Hold on…" : isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="login-toggle">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button onClick={() => { setIsSignUp((s) => !s); setError(""); }}>
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </p>
        </motion.div>
      </div>
    </>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap');

.login-root {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #faf7f2;
  padding: 24px;
  font-family: 'Figtree', system-ui, sans-serif;
}

.login-card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 20px;
  padding: 36px 30px;
  box-shadow: 0 4px 24px rgba(46,42,37,.08), 0 1px 3px rgba(46,42,37,.06);
  border: 1px solid #e8e0d4;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  margin-bottom: 8px;
}

.login-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #b07d5a;
}

.login-name {
  font-size: 22px;
  font-weight: 700;
  color: #2e2a25;
  letter-spacing: -.02em;
}

.login-sub {
  text-align: center;
  font-size: 14px;
  color: #9c9489;
  margin-bottom: 28px;
}

.login-google {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 11px;
  border-radius: 12px;
  border: 1.5px solid #e8e0d4;
  background: #fff;
  color: #2e2a25;
  font-family: 'Figtree', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
}
.login-google:hover { background: #faf7f2; border-color: #d5cec4; }
.login-google:disabled { opacity: .5; cursor: not-allowed; }

.login-divider {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 22px 0;
  font-size: 12px;
  color: #d5cec4;
}
.login-divider::before, .login-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #e8e0d4;
}
.login-divider span { color: #9c9489; }

.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login-input {
  width: 100%;
  padding: 11px 14px;
  border-radius: 12px;
  border: 1.5px solid #e8e0d4;
  background: #faf7f2;
  color: #2e2a25;
  font-family: 'Figtree', system-ui, sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color .15s;
}
.login-input:focus { border-color: #b07d5a; }
.login-input::placeholder { color: #9c9489; }

.login-err {
  font-size: 13px;
  color: #c0392b;
  text-align: center;
  line-height: 1.4;
}

.login-submit {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  border: none;
  background: #b07d5a;
  color: #fff;
  font-family: 'Figtree', system-ui, sans-serif;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity .12s;
  margin-top: 2px;
}
.login-submit:hover { opacity: .88; }
.login-submit:disabled { opacity: .5; cursor: not-allowed; }

.login-toggle {
  text-align: center;
  font-size: 13px;
  color: #9c9489;
  margin-top: 20px;
}
.login-toggle button {
  background: none;
  border: none;
  color: #b07d5a;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Figtree', system-ui, sans-serif;
  font-size: 13px;
}
.login-toggle button:hover { text-decoration: underline; }
`;
