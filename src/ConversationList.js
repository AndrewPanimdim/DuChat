import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'

const GLOBAL_CONVERSATION_ID = '00000000-0000-0000-0000-000000000001'

export default function ConversationList({ user, onSelectConversation }) {
  const [conversations, setConversations] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [showGroupChatModal, setShowGroupChatModal] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState([])
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const [showMenu, setShowMenu] = useState(false)

  // Mark conversation as read when selected
  const markConversationAsRead = useCallback(async (conversationId) => {
    if (!conversationId || !user?.id) return

    const { error } = await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error marking conversation as read:', error)
    } else {
      console.log('✅ Marked conversation as read:', conversationId)
      // Update local state to remove blue dot immediately
      setConversations(prev =>
        prev.map(conv =>
          conv.id === conversationId ? { ...conv, hasUnread: false } : conv
        )
      )
    }
  }, [user?.id])

  const handleSelectConversation = useCallback(async (conversationId) => {
    onSelectConversation(conversationId)
    await markConversationAsRead(conversationId)
  }, [onSelectConversation, markConversationAsRead])

  useEffect(() => {
    loadConversations()
    loadAllUsers()
  }, [])

  // Subscribe to new messages to update unread indicators
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`user_${user.id}_messages`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          console.log('📨 New message detected:', payload)
          
          // If message is not from me, mark that conversation as having unread
          if (payload.new.sender_id !== user.id) {
            setConversations(prev =>
              prev.map(conv =>
                conv.id === payload.new.conversation_id 
                  ? { ...conv, hasUnread: true, updated_at: payload.new.created_at }
                  : conv
              )
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showMenu && !event.target.closest('button')) {
        setShowMenu(false)
      }
    }
    
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showMenu])

  const loadConversations = async () => {
    const { data, error } = await supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
        last_read_at,
        conversations!inner(
          id,
          name,
          is_group,
          updated_at
        )
      `)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error loading conversations:', error)
      setLoading(false)
      return
    }

    const conversationsWithDetails = await Promise.all(
      data.map(async (item) => {
        const conv = item.conversations
        const lastReadAt = item.last_read_at
        
        // Get all participants
        const { data: participants, error: partError } = await supabase
          .from('conversation_participants')
          .select(`
            user_id,
            profiles!inner(id, username, display_name, email)
          `)
          .eq('conversation_id', conv.id)

        if (partError) {
          console.error('Error loading participants:', partError)
          return null
        }

        // Get the most recent message
        const { data: lastMessage, error: lastMsgError } = await supabase
          .from('messages')
          .select('created_at, sender_id')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastMsgError) {
          console.error('Error loading last message:', lastMsgError)
        }

        // Determine if there are unread messages
        let hasUnread = false
        if (lastMessage) {
          // Message is unread if:
          // 1. It's not from me
          // 2. It was sent after I last read the conversation
          const lastMessageTime = new Date(lastMessage.created_at).getTime()
          const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0
          
          hasUnread = (lastMessage.sender_id !== user.id) && (lastMessageTime > lastReadTime)
        }

        // For 1-on-1 chats, get the other user's name
        if (!conv.is_group && participants && participants.length === 2) {
          const otherUser = participants.find(p => p.profiles.id !== user.id)
          conv.displayName = otherUser?.profiles.display_name || otherUser?.profiles.email || 'Unknown'
          conv.otherUserId = otherUser?.profiles.id
        } else if (conv.id === GLOBAL_CONVERSATION_ID) {
          conv.displayName = '🌍 Global Chat'
        } else {
          conv.displayName = conv.name || `Group (${participants?.length || 0})`
        }

        conv.participantCount = participants?.length || 0
        conv.hasUnread = hasUnread
        conv.lastMessageTime = lastMessage?.created_at || conv.updated_at

        return conv
      })
    )

    const validConversations = conversationsWithDetails.filter(c => c !== null)
    setConversations(validConversations.sort((a, b) => 
      new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
    ))
    setLoading(false)
  }

  const loadAllUsers = async () => {
    console.log('Loading all users...')
    console.log('Current user ID:', user.id)
    
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, email')
      .neq('id', user.id)

    console.log('All users response:', data)
    console.log('All users error:', error)
    console.log('Number of users found:', data?.length || 0)

    if (error) {
      console.error('Error loading users:', error)
      setAllUsers([])
    } else {
      setAllUsers(data || [])
    }
  }

  const startDirectChat = async (otherUserId) => {
    try {
      console.log('Starting chat with user:', otherUserId)
      
      // Check if conversation already exists
      const { data: existingParticipants, error: participantsCheckError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, conversations!inner(is_group)')
        .or(`user_id.eq.${user.id},user_id.eq.${otherUserId}`)

      if (participantsCheckError) {
        console.error('Error checking participants:', participantsCheckError)
      }

      if (existingParticipants && existingParticipants.length > 0) {
        const conversationCounts = {}
        
        existingParticipants.forEach(p => {
          if (!p.conversations.is_group) {
            conversationCounts[p.conversation_id] = (conversationCounts[p.conversation_id] || 0) + 1
          }
        })

        const existingConvId = Object.keys(conversationCounts).find(
          convId => conversationCounts[convId] === 2
        )

        if (existingConvId) {
          console.log('Found existing 1-on-1 conversation:', existingConvId)
          handleSelectConversation(existingConvId)
          setShowNewChatModal(false)
          return
        }
      }

      // Create new conversation
      console.log('Creating new conversation...')
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          is_group: false,
          name: null
        })
        .select()
        .single()

      if (convError) {
        console.error('Error creating conversation:', convError)
        throw convError
      }

      console.log('New conversation created:', newConv.id)

      // Add both participants
      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: newConv.id, user_id: user.id, last_read_at: new Date().toISOString() },
          { conversation_id: newConv.id, user_id: otherUserId, last_read_at: new Date().toISOString() }
        ])

      if (participantsError) {
        console.error('Error adding participants:', participantsError)
        throw participantsError
      }

      console.log('Participants added successfully')

      handleSelectConversation(newConv.id)
      await loadConversations()
      setShowNewChatModal(false)
      
    } catch (error) {
      console.error('Full error starting chat:', error)
      alert(`Failed to start conversation: ${error.message || 'Unknown error'}`)
    }
  }

  const createGroupChat = async () => {
    if (selectedUsers.length < 2) {
      alert('Please select at least 2 users for a group chat')
      return
    }
    if (!groupName.trim()) {
      alert('Please enter a group name')
      return
    }

    try {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          is_group: true,
          name: groupName.trim()
        })
        .select()
        .single()

      if (convError) throw convError

      const participantsToAdd = [
        { conversation_id: newConv.id, user_id: user.id, role: 'admin', last_read_at: new Date().toISOString() },
        ...selectedUsers.map(userId => ({
          conversation_id: newConv.id,
          user_id: userId,
          role: 'member',
          last_read_at: new Date().toISOString()
        }))
      ]

      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(participantsToAdd)

      if (participantsError) throw participantsError

      handleSelectConversation(newConv.id)
      loadConversations()
      
      setShowGroupChatModal(false)
      setSelectedUsers([])
      setGroupName('')
    } catch (error) {
      console.error('Error creating group:', error)
      alert('Failed to create group chat')
    }
  }

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>
  }

  return (
    <div style={{ 
      width: '300px', 
      height: '100vh', 
      background: '#f5f5f5', 
      borderRight: '1px solid #ddd',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{ 
        padding: '15px', 
        background: '#003679e1', 
        color: 'white',
        borderBottom: '1px solid #ddd'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 5px 0', fontSize: '18px' }}>Chats</h2>
            <small>{user.email}</small>
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'white',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '5px 10px'
              }}
            >
              ☰
            </button>
            
            {showMenu && (
              <div style={{
                position: 'absolute',
                top: '40px',
                right: '0',
                background: 'white',
                borderRadius: '4px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                minWidth: '150px',
                zIndex: 1000
              }}>
                <button
                  onClick={handleSignOut}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'white',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: '#333',
                    fontSize: '14px',
                    borderRadius: '4px'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = '#f0f0f0'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'white'}
                >
                  🚪 Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ padding: '10px', display: 'flex', gap: '5px' }}>
        <button
          onClick={() => setShowNewChatModal(true)}
          style={{
            flex: 1,
            padding: '8px',
            background: '#0779b7ff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          + New Chat
        </button>
        <button
          onClick={() => setShowGroupChatModal(true)}
          style={{
            flex: 1,
            padding: '8px',
            background: '#128c7e',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          + Group
        </button>
      </div>

      {/* Conversations List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.map(conv => (
          <div
            key={conv.id}
            onClick={() => handleSelectConversation(conv.id)}
            style={{
              padding: '15px',
              borderBottom: '1px solid #e0e0e0',
              cursor: 'pointer',
              background: 'white',
              transition: 'background 0.2s',
              position: 'relative'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#f0f0f0'}
            onMouseOut={(e) => e.currentTarget.style.background = 'white'}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 'bold', flex: 1 }}>
                {conv.is_group && conv.id !== GLOBAL_CONVERSATION_ID && '👥 '}
                {conv.displayName}
              </div>
              {conv.hasUnread && (
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: '#1e90ff',
                    marginLeft: '8px',
                    flexShrink: 0
                  }}
                  title="Unread messages"
                />
              )}
            </div>
            {conv.is_group && conv.id !== GLOBAL_CONVERSATION_ID && (
              <small style={{ color: '#666' }}>
                {conv.participantCount} members
              </small>
            )}
          </div>
        ))}
      </div>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '20px',
            maxWidth: '400px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h3 style={{ marginTop: 0 }}>Start New Chat</h3>
            
            {allUsers.length === 0 ? (
              <div style={{ 
                padding: '20px', 
                textAlign: 'center', 
                color: '#666',
                background: '#f9f9f9',
                borderRadius: '4px',
                marginBottom: '15px'
              }}>
                <p>No other users found.</p>
                <p style={{ fontSize: '14px' }}>
                  To test chatting, create more accounts:
                </p>
                <ol style={{ textAlign: 'left', fontSize: '14px' }}>
                  <li>Sign out</li>
                  <li>Sign up with a different email</li>
                  <li>Verify the email</li>
                  <li>Log back in with this account</li>
                </ol>
              </div>
            ) : (
              <div>
                {allUsers.map(u => (
                  <div
                    key={u.id}
                    onClick={() => startDirectChat(u.id)}
                    style={{
                      padding: '12px',
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      borderRadius: '4px'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f0f0f0'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'white'}
                  >
                    <div style={{ fontWeight: 'bold' }}>
                      {u.display_name || u.username || 'Unknown'}
                    </div>
                    <small style={{ color: '#666' }}>{u.email}</small>
                  </div>
                ))}
              </div>
            )}
            
            <button
              onClick={() => setShowNewChatModal(false)}
              style={{
                marginTop: '15px',
                padding: '8px 16px',
                background: '#ccc',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                width: '100%'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Group Chat Modal */}
      {showGroupChatModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '20px',
            maxWidth: '400px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h3 style={{ marginTop: 0 }}>Create Group Chat</h3>
            
            {allUsers.length < 2 ? (
              <div style={{ 
                padding: '20px', 
                textAlign: 'center', 
                color: '#666',
                background: '#f9f9f9',
                borderRadius: '4px',
                marginBottom: '15px'
              }}>
                <p>You need at least 2 other users to create a group chat.</p>
                <p style={{ fontSize: '14px' }}>
                  Currently found: {allUsers.length} user(s)
                </p>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Group Name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginBottom: '15px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />

                <div style={{ marginBottom: '15px' }}>
                  <strong>Select Members (min 2):</strong>
                  <div style={{ marginTop: '10px' }}>
                    {allUsers.map(u => (
                      <label
                        key={u.id}
                        style={{
                          display: 'block',
                          padding: '8px',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          background: selectedUsers.includes(u.id) ? '#e3f2fd' : 'transparent'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(u.id)}
                          onChange={() => toggleUserSelection(u.id)}
                          style={{ marginRight: '8px' }}
                        />
                        {u.display_name || u.username || 'Unknown'} ({u.email})
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <button
                    onClick={createGroupChat}
                    disabled={selectedUsers.length < 2 || !groupName.trim()}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: (selectedUsers.length >= 2 && groupName.trim()) ? '#128c7e' : '#ccc',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: (selectedUsers.length >= 2 && groupName.trim()) ? 'pointer' : 'not-allowed',
                      fontWeight: 'bold'
                    }}
                  >
                    Create Group
                  </button>
                </div>
              </>
            )}
            
            <button
              onClick={() => {
                setShowGroupChatModal(false)
                setSelectedUsers([])
                setGroupName('')
              }}
              style={{
                width: '100%',
                padding: '10px',
                background: '#ccc',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}