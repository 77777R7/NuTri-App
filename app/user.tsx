import { Redirect, type Href } from 'expo-router';

export default function UserRedirect() {
  return <Redirect href={'/(tabs)/user' as Href} />;
}
