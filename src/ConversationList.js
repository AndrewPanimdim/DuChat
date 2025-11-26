import { useState, useEffect } from 'react'
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

  useEffect(() => {
    loadConversations()
    loadAllUsers()
  }, [])

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
    // Get all conversations user is part of
    const { data, error } = await supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
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

    // Get participants for each conversation to show names
    const conversationsWithDetails = await Promise.all(
      data.map(async (item) => {
        const conv = item.conversations
        
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
        return conv
      })
    )

    const validConversations = conversationsWithDetails.filter(c => c !== null)
    setConversations(validConversations.sort((a, b) => 
      new Date(b.updated_at) - new Date(a.updated_at)
    ))
    setLoading(false)
  }

  const loadAllUsers = async () => {
  console.log('Loading all users...')
  console.log('Current user ID:', user.id)
  
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, email')
    .neq('id', user.id) // Exclude current user

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
      // Check if conversation already exists
      const { data: existingConvId } = await supabase
        .rpc('get_direct_conversation', {
          user1_id: user.id,
          user2_id: otherUserId
        })

      if (existingConvId) {
        // Open existing conversation
        onSelectConversation(existingConvId)
      } else {
        // Create new conversation
        const { data: newConv, error: convError } = await supabase
          .from('conversations')
          .insert({
            is_group: false,
            name: null
          })
          .select()
          .single()

        if (convError) throw convError

        // Add both users to conversation
        const { error: participantsError } = await supabase
          .from('conversation_participants')
          .insert([
            { conversation_id: newConv.id, user_id: user.id },
            { conversation_id: newConv.id, user_id: otherUserId }
          ])

        if (participantsError) throw participantsError

        // Open new conversation
        onSelectConversation(newConv.id)
        loadConversations() // Refresh list
      }
    } catch (error) {
      console.error('Error starting chat:', error)
      alert('Failed to start conversation')
    }
    setShowNewChatModal(false)
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
      // Create group conversation
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          is_group: true,
          name: groupName.trim()
        })
        .select()
        .single()

      if (convError) throw convError

      // Add all selected users + current user
      const participantsToAdd = [
        { conversation_id: newConv.id, user_id: user.id, role: 'admin' },
        ...selectedUsers.map(userId => ({
          conversation_id: newConv.id,
          user_id: userId,
          role: 'member'
        }))
      ]

      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(participantsToAdd)

      if (participantsError) throw participantsError

      // Open new group
      onSelectConversation(newConv.id)
      loadConversations() // Refresh list
      
      // Reset modal
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
            
            {/* Dropdown Menu */}
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
            onClick={() => onSelectConversation(conv.id)}
            style={{
              padding: '15px',
              borderBottom: '1px solid #e0e0e0',
              cursor: 'pointer',
              background: 'white',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#f0f0f0'}
            onMouseOut={(e) => e.currentTarget.style.background = 'white'}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              {conv.is_group && conv.id !== GLOBAL_CONVERSATION_ID && '👥 '}
              {conv.displayName}
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
    </div>
  )
}