import { getLocalModules } from '@/lib/modules';
import ClientViewer from './ClientViewer';

export const dynamic = 'force-dynamic';

export default function Home() {
  // Executé sur le serveur (SSR). Il lit le disque dur en temps réel.
  const modules = getLocalModules();

  console.log("Modules found:", modules.length);

  return <ClientViewer initialModules={modules} />;
}
