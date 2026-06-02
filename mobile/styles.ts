import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4efe7'
  },
  header: {
    padding: 20,
    paddingBottom: 12
  },
  kicker: {
    color: '#c45732',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase'
  },
  title: {
    color: '#16211f',
    fontSize: 34,
    fontWeight: '800'
  },
  notice: {
    color: '#315f7d',
    marginTop: 8
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12
  },
  tab: {
    borderColor: '#d8d0c4',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  activeTab: {
    backgroundColor: '#163832',
    borderColor: '#163832'
  },
  tabText: {
    color: '#16211f',
    fontWeight: '800'
  },
  activeTabText: {
    color: '#fffaf1'
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: {
    gap: 10,
    padding: 20,
    paddingTop: 0
  },
  card: {
    backgroundColor: '#fffaf1',
    borderColor: '#d8d0c4',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14
  },
  cardTitle: {
    color: '#16211f',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4
  },
  cardMeta: {
    color: '#69736e'
  },
  copy: {
    color: '#16211f',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8
  },
  detail: {
    backgroundColor: '#163832',
    borderRadius: 8,
    marginTop: 10,
    padding: 18
  },
  detailKicker: {
    color: '#d8d0c4',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  detailTitle: {
    color: '#fffaf1',
    fontSize: 24,
    fontWeight: '800',
    marginVertical: 6
  },
  textBlock: {
    marginTop: 8
  },
  source: {
    color: '#d8d0c4',
    marginTop: 8
  }
});
