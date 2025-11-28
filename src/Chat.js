import React, { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

function Chat({ conversationId, user, onBack, conversationInfo }) {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const channelRef = useRef(null)

  // Load all messages
  const loadMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        id,
        content,
        sender_id,
        created_at,
        message_type,
        sender:profiles(display_name, email)
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (!error && data) {
      setMessages(data)
      setLoading(false)

      // Auto scroll after loading
      setTimeout(() => {
        scrollToBottom()
      }, 100)
    }
  }

  const scrollToBottom = () => {
    const chatContainer = document.getElementById('chat-messages')
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight
    }
  }
useEffect(() => {
  if (!conversationId) return

  loadMessages()

  let pollInterval
  let isSubscribed = false

  // Remove old channel if exists
  if (channelRef.current) {
    supabase.removeChannel(channelRef.current)
  }

  console.log('📡 Subscribing to conversation:', conversationId)

  const channel = supabase
    .channel(`conversation_${conversationId}`, {
      config: {
        broadcast: { self: true }
      }
    })
    .on(
      'postgres_changes',
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages', 
        filter: `conversation_id=eq.${conversationId}` 
      },
      async (payload) => {
        console.log('🔔 Real-time message received:', payload)
        
        if (isSubscribed) {
          await loadMessages()
        }
      }
    )
    .subscribe((status) => {
      console.log('Subscription status:', status)
      
      if (status === 'SUBSCRIBED') {
        isSubscribed = true
        console.log('✅ Realtime connected!')
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        isSubscribed = false
        console.warn('⚠️ Realtime disconnected, polling will take over')
      }
    })

  channelRef.current = channel

  // POLLING BACKUP: Check every 3 seconds
  let lastMessageCount = 0
  
  pollInterval = setInterval(async () => {
    const { data, count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: false })
      .eq('conversation_id', conversationId)
    
    const currentCount = data?.length || 0
    
    if (lastMessageCount > 0 && currentCount > lastMessageCount) {
      console.log('🔄 Polling detected new messages! Refreshing...')
      await loadMessages()
    }
    
    lastMessageCount = currentCount
  }, 3000) // Poll every 3 seconds

  return () => {
    isSubscribed = false
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    if (pollInterval) {
      clearInterval(pollInterval)
    }
  }
}, [conversationId, user.id])

  // Send message + optimistic UI
  const sendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim()) return

    const messageText = newMessage.trim()

    // --- OPTIMISTIC UI ---
    const tempMessage = {
      id: `temp-${Date.now()}`,
      content: messageText,
      sender_id: user.id,
      conversation_id: conversationId,
      created_at: new Date().toISOString(),
      message_type: 'text',
      sender: {
        display_name: user.display_name || user.email,
        email: user.email
      }
    }

    setMessages(prev => [...prev, tempMessage])

    // Scroll after optimistic render
    setTimeout(() => {
      scrollToBottom()
    }, 50)

    setNewMessage('')

    // --- Insert into Supabase ---
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: messageText,
      message_type: 'text'
    })

    if (error) {
      console.error('Error sending message:', error)
      alert('Failed to send message')

      // Remove the optimistic message
      setMessages(prev => prev.filter(msg => msg.id !== tempMessage.id))
    }
    // Don't manually reload here - real-time subscription will handle it
  }

  if (loading) {
    return <div style={{ padding: '50px', textAlign: 'center' }}>Loading chat...</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div style={{ 
        padding: '15px 20px', 
        background: '#003679e1', 
        color: 'white', 
        display: 'flex', 
        alignItems: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              fontSize: '20px',
              cursor: 'pointer',
              marginRight: '15px',
              padding: '5px 10px'
            }}
          >
            ←
          </button>
        )}
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>
            {conversationInfo?.is_group && '👥 '}
            {conversationInfo?.displayName || 'Chat'}
          </h2>
          {conversationInfo?.is_group && (
            <small style={{ opacity: 0.8 }}>
              {conversationInfo.participants?.length} members
            </small>
          )}
        </div>
      </div>

      {/* Messages Container */}
      <div
        id="chat-messages"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          background: '#e0dfdfff'
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
            <h3>👋 Start the conversation!</h3>
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
                {showSender && !isMyMessage && conversationInfo?.is_group && (
                  <small style={{ 
                    marginLeft: '10px', 
                    marginBottom: '4px', 
                    color: '#075e54',
                    fontWeight: 'bold',
                    fontSize: '12px'
                  }}>
                    {msg.sender?.display_name || msg.sender?.email || 'Anonymous'}
                  </small>
                )}
                <div
                  style={{
                    display: 'inline-block',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    maxWidth: '70%',
                    background: isMyMessage ? '#c6f8f8ff' : 'white',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    wordWrap: 'break-word'
                  }}
                >
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

      {/* Input */}
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
          onChange={e => setNewMessage(e.target.value)}
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
            background: newMessage.trim() ? '#104e7eff' : '#ccc',
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

export default Chat