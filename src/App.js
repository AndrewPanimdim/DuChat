import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Auth from './Auth'
import Chat from './Chat'
import ConversationList from './ConversationList'

const GLOBAL_CONVERSATION_ID = '00000000-0000-0000-0000-000000000001'

function App() {
  const [session, setSession] = useState(null)
  const [selectedConversation, setSelectedConversation] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        setSelectedConversation(null)
      } else {
        // Auto-select global chat when logging in
        setSelectedConversation(GLOBAL_CONVERSATION_ID)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  if (!session) {
    return <Auth />
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <ConversationList 
        user={session.user} 
        onSelectConversation={setSelectedConversation}
      />
      {selectedConversation ? (
        <div style={{ flex: 1 }}>
          <Chat 
            user={session.user} 
            conversationId={selectedConversation}
            onBack={() => setSelectedConversation(null)}
          />
        </div>
      ) : (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#f5f5f5',
          color: '#666'
        }}>
          <div style={{ textAlign: 'center' }}>
            <h2>Select a conversation to start chatting</h2>
            <p>or create a new one</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App