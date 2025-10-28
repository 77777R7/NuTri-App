import React from 'react';
import { Redirect, type Href } from 'expo-router';

export default function QAScreen() {
  return <Redirect href={'/base44/welcome' as Href} />;
}
