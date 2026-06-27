# YourWorkout

Daily Routines Built Around Your Gear — deployable web app with iPhone PWA support.
Powered by Google Gemini's free API tier (no cost, no credit card).

---

## Deploy to Vercel (free, ~10 minutes)

### 1. Get a free Gemini API key
- Go to https://aistudio.google.com
- Sign in with a Google account
- Click **Get API key** → **Create API key**
- Copy it — you'll need it in step 4
- No credit card required. (Note: on the free tier, Google may use your
  prompts to improve their models. For a workout app this is low-stakes.)

### 2. Push this project to GitHub
- Create a free account at https://github.com if needed
- Create a new repository (call it `yourworkout`)
- Upload all these files, or use git:
  ```bash
  git init
  git add .
  git commit -m "Initial commit"
  git remote add origin https://github.com/YOUR_USERNAME/yourworkout.git
  git push -u origin main
  ```

### 3. Connect to Vercel
- Go to https://vercel.com and sign in with your GitHub account
- Click **Add New Project**
- Select your `yourworkout` repository
- Vercel auto-detects it as a Vite project — leave build settings as-is
- Click **Deploy** (it may fail the first time — that's expected, add the key next)

### 4. Add your Gemini API key
- In your Vercel project dashboard, go to **Settings → Environment Variables**
- Add a new variable:
  - **Name:** `GEMINI_API_KEY`
  - **Value:** your key from step 1
  - **Environments:** check Production, Preview, and Development
- Click **Save**
- Go to **Deployments** and click **Redeploy** on the latest deployment

### 5. Your app is live
- Vercel gives you a URL like `https://yourworkout-abc123.vercel.app`
- Open it in Safari on your iPhone

---

## Add to iPhone Home Screen

1. Open your Vercel URL in **Safari** on iPhone
2. Tap the **Share** button (box with arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Name it **YourWorkout** and tap **Add**

It appears as an app icon and launches full-screen with no browser chrome.

---

## What persists

- Your current workout routine
- All weight and rep logs for the day
- Which sets you've marked complete
- Your focus selection

Logs automatically reset each new day (exercises are kept so you can resume or regenerate).

---

## Switching AI providers later

All provider-specific code lives in one file: `api/generate.js`.
The frontend just sends `{ prompt }` and expects `{ text }` back, so swapping
to a different API (Groq, OpenAI, Anthropic, etc.) only means editing that one file.

The current model is `gemini-2.5-flash`. If Google changes their model names,
update the `MODEL` constant near the top of `api/generate.js`.

---

## Local development (optional)

```bash
npm install
npm run dev
```

For local dev, create a `.env.local` file:
```
GEMINI_API_KEY=your_key_here
```
