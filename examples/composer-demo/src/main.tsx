// The composer demo: the composer at the foot of a phone-sized page, attach and camera on. Attach a picture and a Send
// arrow stands beside Hold to talk; one tap sends the picture with no words, and what the app got is written above.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Composer, type ComposerMessage } from 'voice-kit/composer';
import 'voice-kit/composer/styles.css';

function describe(message: ComposerMessage): string {
  const files = message.files.map((file) => `${file.name} (${file.bytes.length} bytes)`).join(', ') || 'no files';
  return `Sent: ${message.text ? `"${message.text}"` : 'no words'}, ${files}`;
}

function App() {
  const [log, setLog] = useState<string[]>([]);
  return (
    <>
      <main style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem' }}>voice-kit composer demo</h1>
        <p>Attach a picture (the paperclip or the camera) and a Send arrow appears beside Hold to talk.</p>
        <ul data-testid="log">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </main>
      <Composer
        attach
        camera
        onSend={(message) => {
          setLog((lines) => [...lines, describe(message)]);
        }}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
