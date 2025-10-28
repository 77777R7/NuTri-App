import { Redirect, type Href } from 'expo-router';

export default function ScanRedirect() {
  return <Redirect href={'/(tabs)/scan' as Href} />;
}
