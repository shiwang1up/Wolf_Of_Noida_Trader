import { View, Text, ScrollView, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { NativeModules } from 'react-native';


const { MyModule } = NativeModules;

export default function HomeScreen() {

  useEffect(() => {
    MyModule?.showToast("Hello from Native! 🎉");  // ?. = safe call
  }, []);


  return (
    <>
      <StatusBar style="dark" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero Banner */}
        <View style={styles.heroSection}>
          <View style={styles.heroTag}>
            <Text style={styles.heroTagText}>TraadeAssist ✦</Text>
          </View>
          <Text style={styles.heroTitle}>Your Smart{'\n'}Trading Partner</Text>
          <Text style={styles.heroSubtitle}>
            Analyse markets, track portfolios and make smarter investment decisions — all in one place.
          </Text>
          <Pressable style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}>
            <Text style={styles.ctaText}>Get Started →</Text>
          </Pressable>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          {[
            { label: 'Active Traders', value: '12K+' },
            { label: 'Avg. Returns', value: '18%' },
            { label: 'Signals Today', value: '240' },
          ].map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Feature Cards */}
        <Text style={styles.sectionTitle}>What We Offer</Text>
        <View style={styles.cardsGrid}>
          {features.map((feature) => (
            <Pressable key={feature.title} style={({ pressed }) => [styles.featureCard, pressed && styles.featureCardPressed]}>
              <Text style={styles.featureEmoji}>{feature.emoji}</Text>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureDesc}>{feature.desc}</Text>
            </Pressable>
          ))}
        </View>

        {/* CTA Banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>Ready to trade smarter?</Text>
          <Text style={styles.bannerSubtitle}>Join thousands of traders using TraadeAssist daily.</Text>
          <Pressable style={styles.bannerButton}>
            <Text style={styles.bannerButtonText}>Create Free Account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

const features = [
  { emoji: '📈', title: 'Live Signals', desc: 'Real-time buy/sell signals powered by AI analysis.' },
  { emoji: '🛡️', title: 'Risk Guard', desc: 'Automatic stop-loss recommendations to protect gains.' },
  { emoji: '📊', title: 'Portfolio Analytics', desc: 'Deep insights into your holdings and performance.' },
  { emoji: '🔔', title: 'Smart Alerts', desc: 'Custom price and news alerts for your watchlist.' },
];

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingBottom: theme.spacing.xxxl,
  },

  // ─── Hero ────────────────────────────────────────────────────────────────
  heroSection: {
    backgroundColor: theme.colors.backgroundWarm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: 72,
    paddingBottom: theme.spacing.xxl,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroTag: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  heroTagText: {
    color: theme.colors.textInverse,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: theme.fontSize.display,
    fontWeight: theme.fontWeight.extrabold,
    color: theme.colors.text,
    lineHeight: 44,
    marginBottom: theme.spacing.md,
  },
  heroSubtitle: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    lineHeight: 24,
    marginBottom: theme.spacing.xl,
  },
  ctaButton: {
    backgroundColor: theme.colors.cta,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    alignSelf: 'flex-start',
    ...theme.shadow.md,
  },
  ctaButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  ctaText: {
    color: theme.colors.textInverse,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
  },

  // ─── Stats ───────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: theme.spacing.lg,
    marginTop: -theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    marginHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    ...theme.shadow.sm,
  },
  statValue: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.extrabold,
    color: theme.colors.primary,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },

  // ─── Features ────────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  featureCard: {
    width: '46%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    margin: theme.spacing.xs,
    padding: theme.spacing.md,
    ...theme.shadow.sm,
  },
  featureCardPressed: {
    transform: [{ scale: 0.97 }],
  },
  featureEmoji: {
    fontSize: 28,
    marginBottom: theme.spacing.sm,
  },
  featureTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  featureDesc: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },

  // ─── Banner ──────────────────────────────────────────────────────────────
  banner: {
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    alignItems: 'center',
    ...theme.shadow.lg,
  },
  bannerTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.extrabold,
    color: theme.colors.textInverse,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  bannerSubtitle: {
    fontSize: theme.fontSize.md,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
    lineHeight: 22,
  },
  bannerButton: {
    backgroundColor: theme.colors.textInverse,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
  },
  bannerButtonText: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.bold,
    fontSize: theme.fontSize.md,
  },
}));
