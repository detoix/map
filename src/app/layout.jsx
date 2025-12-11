import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';

export const metadata = {
  title: 'urPlot',
  description: 'Mapbox + Three.js demo',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
