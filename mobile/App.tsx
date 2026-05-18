import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <Text style={styles.kicker}>Mapa / Lista Publica</Text>
        <Text style={styles.title}>Lisboa por Outros</Text>
        <Text style={styles.copy}>Shell mobile inicial. O mapa e o detalhe de ponto entram nas proximas etapas.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#163832'
  },
  shell: {
    flex: 1,
    justifyContent: 'center',
    padding: 28
  },
  kicker: {
    color: '#d8d0c4',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase'
  },
  title: {
    color: '#fffaf1',
    fontSize: 38,
    fontWeight: '800',
    marginBottom: 16
  },
  copy: {
    color: '#f4efe7',
    fontSize: 17,
    lineHeight: 24
  }
});
