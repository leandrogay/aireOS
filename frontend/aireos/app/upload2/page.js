import MappingDiv from '../components/upload2/MappingDiv';

// Route for the aireOS mapping harness. The harness is a Client Component
// (state, event handlers, browser fetch), so this page stays a Server
// Component and simply renders it.
export default function MappingPage() {
  return <MappingDiv />;
}