import { View, Text, ScrollView, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { StatusBar } from 'expo-status-bar';

export default function ExploreScreen() {

  return (
    <>
      <StatusBar style="dark" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>EXPLORE</Text>
          <Text style={styles.headerTitle}>Discover Tools{'\n'}& Resources</Text>
          <Text style={styles.headerSubtitle}>
            Everything you need to become a better trader — from education to live tools.
          </Text>
        </View>

        {/* Category Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsContainer}>
          {categories.map((cat, i) => (
            <Pressable key={cat} style={({ pressed }) => [styles.pill, i === 0 && styles.pillActive, pressed && styles.pillPressed]}>
              <Text style={[styles.pillText, i === 0 && styles.pillTextActive]}>{cat}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Highlight Card */}
        <View style={styles.highlightCard}>
          <View style={styles.highlightBadge}>
            <Text style={styles.highlightBadgeText}>NEW</Text>
          </View>
          <Text style={styles.highlightTitle}>AI Market Sentiment</Text>
          <Text style={styles.highlightDesc}>
            Our new AI model scans thousands of articles and social posts to give you a real-time sentiment score for any stock.
          </Text>
          <Pressable style={styles.highlightCTA}>
            <Text style={styles.highlightCTAText}>Try it now →</Text>
          </Pressable>
        </View>

        {/* Resource List */}
        <Text style={styles.sectionTitle}>Learning Resources</Text>
        {resources.map((resource) => (
          <Pressable key={resource.title} style={({ pressed }) => [styles.resourceRow, pressed && styles.resourceRowPressed]}>
            <View style={[styles.resourceIcon, { backgroundColor: resource.iconBg }]}>
              <Text style={styles.resourceEmoji}>{resource.emoji}</Text>
            </View>
            <View style={styles.resourceInfo}>
              <Text style={styles.resourceTitle}>{resource.title}</Text>
              <Text style={styles.resourceMeta}>{resource.meta}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        {/* Gold Badge Section */}
        <View style={styles.badgeSection}>
          <Text style={styles.badgeEmoji}>🏆</Text>
          <Text style={styles.badgeTitle}>TraadeAssist Pro</Text>
          <Text style={styles.badgeDesc}>Unlock advanced analytics, priority signals, and 1-on-1 mentorship sessions.</Text>
          <Pressable style={styles.badgeButton}>
            <Text style={styles.badgeButtonText}>Upgrade to Pro</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

const categories = ['All', 'Stocks', 'Crypto', 'Options', 'Forex', 'Commodities'];

const resources = [
  { emoji: '📚', title: 'Trading Basics 101', meta: '12 lessons · Beginner', iconBg: '#E6F6FD' },
  { emoji: '🎯', title: 'Technical Analysis', meta: '8 lessons · Intermediate', iconBg: '#FFF0EA' },
  { emoji: '🧮', title: 'Options Strategies', meta: '15 lessons · Advanced', iconBg: '#FFF3CD' },
  { emoji: '🌐', title: 'Macro Economics', meta: '10 lessons · Intermediate', iconBg: '#FFE4E8' },
];

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingBottom: theme.spacing.xxxl,
  },

  // ─── Header ──────────────────────────────────────────────────────────────
  header: {
    paddingTop: 72,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    backgroundColor: theme.colors.backgroundSecondary,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginBottom: theme.spacing.lg,
  },
  headerEyebrow: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    letterSpacing: 2,
    marginBottom: theme.spacing.sm,
  },
  headerTitle: {
    fontSize: theme.fontSize.xxxl,
    fontWeight: theme.fontWeight.extrabold,
    color: theme.colors.text,
    lineHeight: 38,
    marginBottom: theme.spacing.sm,
  },
  headerSubtitle: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textSecondary,
    lineHeight: 22,
  },

  // ─── Pills ───────────────────────────────────────────────────────────────
  pillsContainer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  pill: {
    borderRadius: theme.radius.full,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    marginRight: theme.spacing.xs,
  },
  pillActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  pillPressed: {
    opacity: 0.75,
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.textSecondary,
  },
  pillTextActive: {
    color: theme.colors.textInverse,
  },

  // ─── Highlight Card ──────────────────────────────────────────────────────
  highlightCard: {
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
    backgroundColor: theme.colors.text,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    ...theme.shadow.lg,
  },
  highlightBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.cta,
    borderRadius: theme.radius.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    marginBottom: theme.spacing.md,
  },
  highlightBadgeText: {
    color: theme.colors.textInverse,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.extrabold,
    letterSpacing: 1,
  },
  highlightTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textInverse,
    marginBottom: theme.spacing.sm,
  },
  highlightDesc: {
    fontSize: theme.fontSize.sm,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 20,
    marginBottom: theme.spacing.lg,
  },
  highlightCTA: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  highlightCTAText: {
    color: theme.colors.textInverse,
    fontWeight: theme.fontWeight.bold,
    fontSize: theme.fontSize.md,
  },

  // ─── Resources ───────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  resourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    ...theme.shadow.sm,
  },
  resourceRowPressed: {
    transform: [{ scale: 0.98 }],
  },
  resourceIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  resourceEmoji: {
    fontSize: 22,
  },
  resourceInfo: {
    flex: 1,
  },
  resourceTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: 2,
  },
  resourceMeta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  chevron: {
    fontSize: 22,
    color: theme.colors.textMuted,
  },

  // ─── Badge Section ───────────────────────────────────────────────────────
  badgeSection: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.xl,
    backgroundColor: theme.colors.badge,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    alignItems: 'center',
    ...theme.shadow.md,
  },
  badgeEmoji: {
    fontSize: 36,
    marginBottom: theme.spacing.sm,
  },
  badgeTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.extrabold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  badgeDesc: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: theme.spacing.lg,
  },
  badgeButton: {
    backgroundColor: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
  },
  badgeButtonText: {
    color: theme.colors.textInverse,
    fontWeight: theme.fontWeight.bold,
    fontSize: theme.fontSize.md,
  },
}));
