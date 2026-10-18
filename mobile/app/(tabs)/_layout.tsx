import { Tabs } from 'expo-router'
import { usePrefs } from '../../lib/prefs'
import { useRecording } from '../../lib/recording'
import { BookIcon, CardsIcon, ClockIcon, GearIcon, MicIcon } from '../../components/icons'

export default function TabLayout() {
  const { c, font } = usePrefs()
  const { status } = useRecording()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.fgFaint,
        tabBarStyle: { backgroundColor: c.tabBar, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: font(600), fontSize: 11 },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: 'Record',
        tabBarIcon: ({ color }) => <MicIcon color={color} />,
        // A quiet dot on the tab while a lecture is being recorded, so it is
        // obvious from anywhere in the app.
        tabBarBadge: status === 'recording' ? '' : undefined,
        tabBarBadgeStyle: { backgroundColor: c.calm, minWidth: 10, maxHeight: 10, borderRadius: 5, marginTop: 4 },
      }} />
      <Tabs.Screen name="glossary" options={{ title: 'Glossary', tabBarIcon: ({ color }) => <BookIcon color={color} /> }} />
      <Tabs.Screen name="flashcards" options={{ title: 'Flashcards', tabBarIcon: ({ color }) => <CardsIcon color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: 'Lectures', tabBarIcon: ({ color }) => <ClockIcon color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <GearIcon color={color} /> }} />
    </Tabs>
  )
}
