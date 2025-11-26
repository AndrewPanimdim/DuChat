import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

function Chat({ conversationId, user }) {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')

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

      // Auto scroll after loading
      setTimeout(() => {
        const chatContainer = document.getElementById('chat-messages')
        if (chatContainer) {
          chatContainer.scrollTop = chatContainer.scrollHeight
        }
      }, 100)
    }
  }

  // Realtime subscription for new messages
  useEffect(() => {
    loadMessages()

    const channel = supabase
      .channel(`conversation_${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        payload => {
          setMessages(prev => [...prev, payload.new])

          // Auto scroll for realtime messages
          setTimeout(() => {
            const chatContainer = document.getElementById('chat-messages')
            if (chatContainer) {
              chatContainer.scrollTop = chatContainer.scrollHeight
            }
          }, 100)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

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
        display_name: user.display_name,
        email: user.email
      }
    }

    setMessages(prev => [...prev, tempMessage])

    // Scroll after optimistic render
    setTimeout(() => {
      const chatContainer = document.getElementById('chat-messages')
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight
      }
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
    } else {
      await loadMessages()
    }
  }

  return (
    <div className="chat-container">

      {/* Messages Container */}
      <div
        id="chat-messages"
        style={{
          height: '70vh',
          overflowY: 'auto',
          padding: '1rem',
          background: '#f1f1f1',
          borderRadius: '8px'
        }}
      >
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              textAlign: msg.sender_id === user.id ? 'right' : 'left',
              marginBottom: '10px'
            }}
          >
            <div
              style={{
                display: 'inline-block',
                padding: '10px',
                borderRadius: '10px',
                background: msg.sender_id === user.id ? '#007bff' : '#ddd',
                color: msg.sender_id === user.id ? 'white' : 'black'
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} style={{ marginTop: '1rem', display: 'flex' }}>
        <input
          type="text"
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          placeholder="Type your message..."
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '5px',
            border: '1px solid #ccc'
          }}
        />

        <button
          type="submit"
          style={{
            marginLeft: '8px',
            padding: '10px 20px',
            borderRadius: '5px',
            background: '#007bff',
            color: 'white',
            border: 'none'
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}

export default Chat
