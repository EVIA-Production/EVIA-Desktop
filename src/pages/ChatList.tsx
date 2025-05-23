
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, MessageSquare, Calendar } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { chatService } from '@/services/chatService';
import { API_BASE_URL } from '@/config/config';

interface Chat {
  id: string;
  created_at: string;
  user_id: string;
}

const ChatList = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    fetchChats();
  }, []);

  const fetchChats = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/chats/`, {
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch chats');
      }

      const chatData = await response.json();
      setChats(chatData);
    } catch (error) {
      console.error('Error fetching chats:', error);
      toast({
        title: "Error",
        description: "Failed to load chats",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const createNewChat = async () => {
    try {
      const newChatId = await chatService.createChat();
      toast({
        description: "New chat created",
      });
      navigate('/');
    } catch (error) {
      console.error('Failed to create chat:', error);
      toast({
        title: "Error",
        description: "Failed to create new chat",
        variant: "destructive"
      });
    }
  };

  const selectChat = (chatId: string) => {
    localStorage.setItem('current_chat_id', chatId);
    navigate('/');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-white text-xl">Loading chats...</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Your Chats</h1>
          <Button 
            onClick={createNewChat}
            className="bg-primary hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </div>

        {chats.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">No chats yet</h2>
            <p className="text-gray-400 mb-6">Create your first chat to get started</p>
            <Button onClick={createNewChat} className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" />
              Create First Chat
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {chats.map((chat) => (
              <Card 
                key={chat.id} 
                className="bg-card border-border hover:bg-accent/50 transition-colors cursor-pointer"
                onClick={() => selectChat(chat.id)}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center text-white">
                    <MessageSquare className="mr-2 h-5 w-5" />
                    Chat
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center text-sm text-gray-400">
                    <Calendar className="mr-2 h-4 w-4" />
                    {formatDate(chat.created_at)}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">ID: {chat.id.slice(0, 8)}...</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ChatList;
