/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // public/ does not auto-serve directory indexes — send /sweepdesk to its
    // index.html so the app's relative asset paths resolve inside the folder.
    return [
      { source: '/sweepdesk', destination: '/sweepdesk/index.html', permanent: false },
    ];
  },
};

export default nextConfig;
