# Rally Panties DesignOps

AI-Powered Design + Mockup + Shopify Publisher

## Getting Started

### Prerequisites

- Node.js 18+ 
- Firebase project with Firestore and Storage enabled
- Firebase CLI (optional, for deploying rules)

### Environment Variables

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication with Google provider
3. Enable Firestore Database
4. Enable Storage
5. Add your environment variables to `.env.local`
6. Deploy Firestore rules (optional):
   ```bash
   firebase deploy --only firestore:rules
   ```

### Initial Admin Setup

After signing in with Google, you'll need to manually create an admin document in Firestore:

1. Go to Firestore Console
2. Create collection `admins`
3. Create document with your user UID (found in Firebase Auth)
4. Set fields:
   - `email`: your email
   - `role`: `"admin"` | `"editor"` | `"viewer"`
   - `createdAt`: timestamp

Example:
```json
{
  "email": "your-email@example.com",
  "role": "admin",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

## Project Structure

```
├── app/                  # Next.js App Router
│   ├── dashboard/       # Main dashboard page
│   ├── login/           # Login page
│   ├── layout.tsx       # Root layout
│   └── page.tsx         # Home (redirects to dashboard)
├── components/          # React components
│   ├── LoginPage.tsx
│   └── ProtectedRoute.tsx
├── lib/
│   ├── firebase/        # Firebase configuration and utilities
│   └── hooks/           # Custom React hooks
├── firestore.rules      # Firestore security rules
└── storage.rules        # Storage security rules
```

## Phase 0 Complete ✅

- Next.js + TypeScript setup
- Firebase integration (Auth, Firestore, Storage)
- Google Authentication
- Admin-only access control
- Protected routes with role-based permissions
- Basic dashboard shell

## Next Steps (Phase 1)

See `RallyPanties_DesignOps_BuildSpec.md` for the full build plan.
