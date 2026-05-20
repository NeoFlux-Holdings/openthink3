/* Root screen — auth gate.
 *
 * If a session is saved, we deep-link the user into the Today screen.
 * Otherwise we show the sign-in screen.
 */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useSession } from '../src/lib/session-store';
import { useTheme } from '../src/theme/ThemeContext';

export default function Index() {
  const { session, loading } = useSession();
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    if (loading) return;
    if (session) router.replace('/today');
    else router.replace('/sign-in');
  }, [session, loading, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}
