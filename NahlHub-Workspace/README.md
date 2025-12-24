# NahlHub

NahlHub is a workspace and app management platform that allows users to manage multiple workspaces, install apps from a marketplace, and collaborate with team members.

## Features

- 🔐 **OTP Authentication** - Secure login via WhatsApp OTP
- 🌍 **Multi-language** - Arabic (RTL) and English (LTR) support
- 🎨 **Themes** - Light and dark mode
- 👥 **Workspace Management** - Create and manage multiple workspaces
- 📱 **App Marketplace** - Browse and install apps
- 👨‍👩‍👧‍👦 **Team Management** - Invite members, manage roles
- 📊 **App Management** - Install, configure, and use apps within workspaces

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Backend:** Vercel Serverless Functions (Node.js)
- **Backend API:** Google Apps Script
- **Authentication:** OTP via GreenAPI (WhatsApp)
- **Deployment:** Vercel

## Project Structure

```
NahlHub-Workspace/
├── api/                    # Vercel serverless functions
│   └── hub/
│       ├── manage.js      # Main API proxy
│       └── otp/
│           └── request.js  # OTP request handler
├── lib/                    # Shared utilities
│   ├── env.js             # Environment variable helpers
│   ├── greenapi.js        # GreenAPI WhatsApp integration
│   ├── http.js            # HTTP utilities
│   └── otp.js             # OTP generation and validation
├── public/                 # Public assets
│   └── hub/
│       ├── api.js         # API wrapper
│       ├── state.js       # State management
│       └── ui.members.js  # Members UI module
├── index.html             # Main application
├── package.json           # Project dependencies
├── vercel.json            # Vercel configuration
└── README.md              # This file
```

## Setup

### Prerequisites

- Node.js 18+ 
- Vercel CLI (for deployment)
- Google Apps Script project (backend)
- GreenAPI account (for WhatsApp OTP)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd NahlHub-Workspace
   ```

2. **Install dependencies** (if any)
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the root directory (see `.env.example` for reference):
   ```env
   HUB_BACKEND_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
   HUB_APP_ID=HUB
   GREEN_API_URL=https://api.green-api.com
   GREEN_API_INSTANCE_ID=your_instance_id
   GREEN_API_TOKEN=your_token
   OTP_HMAC_SECRET=your_hmac_secret
   OTP_LENGTH=4
   OTP_TTL_MIN=10
   ```

4. **Deploy to Vercel**
   ```bash
   vercel
   ```

   Or use the Vercel dashboard to connect your repository.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `HUB_BACKEND_URL` | Apps Script WebApp URL | Yes |
| `HUB_APP_ID` | Application ID (default: "HUB") | No |
| `GREEN_API_URL` | GreenAPI base URL | No |
| `GREEN_API_INSTANCE_ID` | GreenAPI instance ID | Yes |
| `GREEN_API_TOKEN` | GreenAPI token | Yes |
| `OTP_HMAC_SECRET` | HMAC secret for OTP signing | Yes |
| `OTP_LENGTH` | OTP code length (default: 4) | No |
| `OTP_TTL_MIN` | OTP expiration in minutes (default: 10) | No |

## API Endpoints

### Main API Proxy
- **URL:** `/api/hub/manage`
- **Method:** POST
- **Description:** Proxies requests to Apps Script backend

### OTP Request
- **URL:** `/api/hub/otp/request`
- **Method:** POST
- **Description:** Request OTP via WhatsApp

### Health Check
- **URL:** `/api/hub/manage?action=health`
- **Method:** GET
- **Description:** Check API health status

## Backend Actions

The platform supports various backend actions via the Apps Script backend:

### Authentication
- `sendOtp` / `auth.requestOtp` - Send OTP code
- `verifyOtp` - Verify OTP and authenticate
- `auth.me` - Get current user info
- `auth.logout` - Logout user

### Workspace
- `workspace.listForUser` - List user workspaces
- `workspace.members` - List workspace members
- `workspace.invite` - Invite member
- `workspace.updateMemberRole` - Update member role
- `workspace.removeMember` - Remove member
- `workspace.revokeInvite` - Revoke invite

### Marketplace
- `marketplace.listWorkspaceApps` - List installed apps
- `marketplace.listTemplates` - List available templates
- `marketplace.installApp` - Install app from template

## Development

### Local Development

1. **Start Vercel dev server**
   ```bash
   npm run dev
   # or
   vercel dev
   ```

2. **Open browser**
   Navigate to `http://localhost:3000`

### Code Organization

The codebase is organized into modules:

- `public/hub/config.js` - Configuration constants
- `public/hub/i18n.js` - Internationalization
- `public/hub/api.js` - API wrapper
- `public/hub/auth.js` - Authentication logic
- `public/hub/workspace.js` - Workspace management
- `public/hub/apps.js` - App management
- `public/hub/ui.js` - UI utilities
- `public/hub/main.js` - Main application

## Deployment

### Vercel

1. **Connect repository** to Vercel
2. **Set environment variables** in Vercel dashboard
3. **Deploy** automatically on push to main branch

### Manual Deployment

```bash
vercel --prod
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC

## Support

For issues and questions, please open an issue on GitHub.

## Changelog

### Version 1.0.0
- Initial release
- OTP authentication
- Workspace management
- App marketplace
- Team management
- Multi-language support
- Theme support

