# Campus Quiz

A mobile-friendly React/Vite quiz for pre-campus events. Cloudflare Pages hosts the static frontend; Supabase provides authentication, Postgres, and server-side quiz operations. The public student view only shows QR-scan instructions and a room-code entry. Question import and quiz controls live at `/organizer`, which checks organizer sign-in and role before showing any question-management screen. Students join individually by QR code or room code, questions advance on server-timed deadlines, late arrivals can join during the quiz, and the app displays the top three when the quiz ends.

## Question upload format

Download the CSV template from the organizer screen and fill one question per row. Keep the header names unchanged. The organizer screen previews every question, its choices, the correct answer, and timer before room creation.

| Column | Required | Details |
| --- | --- | --- |
| `question` | Yes | Question text, up to 1,000 characters |
| `option_a` to `option_d` | Yes | Exactly four answer choices, each up to 500 characters |
| `correct_answer` | Yes | The letter `A`, `B`, `C`, or `D` |
| `seconds` | Yes | Whole number from 5 to 300; each question has its own timer |

Quote CSV fields containing commas, quotes, or line breaks using normal CSV quoting. The organizer preview validates the file before creating a room. Question content and answer keys are stored in Supabase; answer keys are never returned to player clients.

## Prerequisites

- Node.js LTS and npm
- A Supabase project
- A Cloudflare account
- A GitHub repository for automatic Cloudflare deployments

## 1. Configure Supabase

1. Create a Supabase project. Choose a region close to the event.
2. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins** for players.
3. In **Authentication → Users**, add an organizer user with an email and password. Copy that user's UUID.
4. Open **SQL Editor**, paste and run the migration files in order: [`20261010000000_initial_quiz.sql`](./supabase/migrations/20261010000000_initial_quiz.sql), then [`20261010001000_organizer_role_check.sql`](./supabase/migrations/20261010001000_organizer_role_check.sql). The second file is safe to run on a database that already has the initial schema.
5. Register the organizer UUID in the SQL Editor, replacing the example with the copied UUID:

   ```sql
   insert into public.quiz_organizers (user_id)
   values ('00000000-0000-0000-0000-000000000000');
   ```

6. From the Supabase project's **Connect** panel, copy the Project URL and publishable key. The key is intended for the browser; do not use a service-role key.

The migration enables RLS and revokes direct table access from browser roles. The UI uses database functions for all quiz operations; the functions validate organizer permissions, participant membership, timers, answer uniqueness, room capacity, and score calculations.

## 2. Run locally

From the project directory in PowerShell:

```powershell
npm.cmd install
```

Create `.env.local` in the project root:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Start the development server:

```powershell
npm.cmd run dev
```

Open the local URL printed by Vite. The root URL is the student join screen; open `/organizer` to sign in, upload a valid CSV, and create a room. Scan its QR code with a phone. Check the timed transitions, joining after the start, duplicate-answer rejection, student/organizer screen separation, and final podium before deploying.

The app enforces a maximum of **49 participants**. Once a player joins, their anonymous Supabase identity and display name are retained for that browser session so reconnects work. The final results remain available on screen after the quiz. When they are no longer needed, the organizer can choose **Delete quiz and results**; this permanently removes the session, questions, participant names, and answers.

## 3. Build and verify

```powershell
npm.cmd run build
npm.cmd run lint
```

Vite writes the deployable static site to `dist`.

## 4. Push to GitHub

Create an empty repository on GitHub, then run the following from the project directory, replacing the URL:

```powershell
git init
git add .
git commit -m "Build campus quiz app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Check that `.env.local` is not included in the staged files before committing.

## 5. Deploy to Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Import an existing Git repository**.
2. Connect GitHub and select this repository.
3. Set the production branch to `main`.
4. Configure the build:
   - Framework preset: **React (Vite)**, if available
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `/`
5. In the Pages project's **Settings → Environment variables**, add these for **Production** (and **Preview** if you want to test preview deployments):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. Save settings and deploy. Vite embeds these publishable values into the frontend at build time, so redeploy after changing either.
7. Open the assigned `*.pages.dev` address and rehearse the complete flow on phones. The organizer's QR code will encode the deployed site's join URL.

## Event-day checklist

- Open the production site and make sure the Supabase project is active.
- Create the quiz room and display the QR code.
- Test joining from a phone on the venue Wi-Fi and on mobile data.
- Keep the organizer page open for participant count and timer status.
- This version polls Supabase for quiz state rather than opening a persistent Realtime connection. Free plans have limited compute and quotas and do not guarantee event-day availability, so test with the expected audience before the event.
- Delete the finished quiz from the organizer screen after everyone has seen the podium if you do not need to retain the data.
