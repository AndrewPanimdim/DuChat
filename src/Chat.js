import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

// FIXED CONVERSATION ID - everyone uses this same conversation
const GLOBAL_CONVERSATION_ID = '00000000-0000-0000-0000-000000000001'

export default function Chat({ user }) {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    initializeChat()
  }, [])

  const initializeChat = async () => {
    try {
      // Check if user is already in the global conversation
      const { data: existingParticipant } = await supabase
        .from('conversation_participants')
        .select('id')
        .eq('conversation_id', GLOBAL_CONVERSATION_ID)
        .eq('user_id', user.id)
        .single()

      // If not in conversation, add them
      if (!existingParticipant) {
        const { error: joinError } = await supabase
          .from('conversation_participants')
          .insert({
            conversation_id: GLOBAL_CONVERSATION_ID,
            user_id: user.id
          })

        if (joinError) {
          console.error('Error joining conversation:', joinError)
        }
      }

      // Load existing messages
      await loadMessages()
      
      // Subscribe to new messages
      subscribeToMessages()
      
    } catch (error) {
      console.error('Error initializing chat:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        sender:profiles(username, display_name, avatar_url)
      `)
      .eq('conversation_id', GLOBAL_CONVERSATION_ID)
      .order('created_at', { ascending: true })
      .limit(100) // Load last 100 messages

    if (error) {
      console.error('Error loading messages:', error)
    } else {
      setMessages(data || [])
    }
  }

  const subscribeToMessages = () => {
    const channel = supabase
      .channel('global-chat')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${GLOBAL_CONVERSATION_ID}`
      }, async (payload) => {
        // Fetch sender info for the new message
        const { data: sender } = await supabase
          .from('profiles')
          .select('username, display_name, avatar_url')
          .eq('id', payload.new.sender_id)
          .single()

        setMessages(prev => [...prev, { ...payload.new, sender }])
        
        // Auto-scroll to bottom when new message arrives
        setTimeout(() => {
          const chatContainer = document.getElementById('chat-messages')
          if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight
          }
        }, 100)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  const sendMessage = async (e) => {
  e.preventDefault()
  if (!newMessage.trim()) return

  const { error } = await supabase
    .from('messages')
    .insert({
      conversation_id: GLOBAL_CONVERSATION_ID,
      sender_id: user.id,
      content: newMessage.trim(),
      message_type: 'text'
    })

  if (error) {
    console.error('Error sending message:', error)
    alert('Failed to send message')
  } else {
    setNewMessage('')

    // 🔥 RELOAD MESSAGES AFTER SENDING
    await loadMessages()

    // 🔥 AUTO-SCROLL AFTER RELOAD
    setTimeout(() => {
      const chatContainer = document.getElementById('chat-messages')
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight
      }
    }, 100)
  }
}


  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
    return <div style={{ padding: '50px', textAlign: 'center' }}>Loading chat...</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div style={{ 
        padding: '15px 20px', 
        background: '#075e54', 
        color: 'white', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px' }}>🌍 Global Chat Room</h2>
          <small style={{ opacity: 0.8 }}>Logged in as: {user.email}</small>
        </div>
        <button 
          onClick={handleSignOut} 
          style={{ 
            padding: '8px 16px', 
            cursor: 'pointer',
            background: '#128c7e',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '14px'
          }}
        >
          Sign Out
        </button>
      </div>

      {/* Messages Area */}
      <div 
        id="chat-messages"
        style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: '20px', 
          background: '#e5ddd5',
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width="100" height="100" xmlns="http://www.w3.org/2000/svg"%3E%3Cpath d="M0 0h100v100H0z" fill="%23e5ddd5"/%3E%3C/svg%3E")'
        }}
      >
        {messages.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            color: '#666', 
            marginTop: '50px',
            padding: '20px',
            background: 'white',
            borderRadius: '8px',
            maxWidth: '400px',
            margin: '50px auto'
          }}>
            <h3>👋 Welcome to Global Chat!</h3>
            <p>No messages yet. Be the first to say hello!</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMyMessage = msg.sender_id === user.id
            const showSender = index === 0 || messages[index - 1].sender_id !== msg.sender_id
            
            return (
              <div 
                key={msg.id} 
                style={{ 
                  margin: '8px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isMyMessage ? 'flex-end' : 'flex-start'
                }}
              >
                {showSender && !isMyMessage && (
                  <small style={{ 
                    marginLeft: '10px', 
                    marginBottom: '4px', 
                    color: '#075e54',
                    fontWeight: 'bold',
                    fontSize: '12px'
                  }}>
                    {msg.sender?.display_name || msg.sender?.username || 'Anonymous'}
                  </small>
                )}
                <div style={{ 
                  padding: '8px 12px', 
                  background: isMyMessage ? '#dcf8c6' : 'white',
                  borderRadius: '8px',
                  maxWidth: '70%',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  wordWrap: 'break-word'
                }}>
                  <div style={{ fontSize: '14px' }}>{msg.content}</div>
                  <div style={{ 
                    fontSize: '11px', 
                    color: '#667781',
                    marginTop: '4px',
                    textAlign: 'right'
                  }}>
                    {new Date(msg.created_at).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Input Area */}
      <form 
        onSubmit={sendMessage} 
        style={{ 
          display: 'flex', 
          padding: '10px 20px', 
          background: '#f0f0f0', 
          borderTop: '1px solid #ddd',
          gap: '10px'
        }}
      >
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          style={{ 
            flex: 1, 
            padding: '12px 16px', 
            border: '1px solid #ddd', 
            borderRadius: '24px', 
            fontSize: '14px',
            outline: 'none'
          }}
        />
        <button 
          type="submit" 
          disabled={!newMessage.trim()}
          style={{ 
            padding: '12px 24px', 
            background: newMessage.trim() ? '#075e54' : '#ccc', 
            color: 'white', 
            border: 'none', 
            borderRadius: '24px', 
            cursor: newMessage.trim() ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            fontWeight: 'bold',
            minWidth: '80px'
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}