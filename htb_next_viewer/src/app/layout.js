import './globals.css'

export const metadata = {
  title: 'HTBrain - Cybersecurity Learning Platform',
  description: 'A comprehensive platform for cybersecurity education, featuring structured modules and practical vulnerability write-ups.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
