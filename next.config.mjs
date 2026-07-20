/** @type {import('next').NextConfig} */
const nextConfig = {
  // The repo's eslint-config-next setup requires a typescript install this
  // JS-only project doesn't have, which fails deploy builds on Vercel.
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    // public/ does not auto-serve directory indexes — send /sweepdesk to its
    // index.html so the app's relative asset paths resolve inside the folder.
    return [
      { source: '/sweepdesk', destination: '/sweepdesk/index.html', permanent: false },
    ];
  },
};

export default nextConfig;
