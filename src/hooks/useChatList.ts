import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatService } from '@/services/chatService';
import { useToast } from '@/hooks/use-toast';

interface Chat {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string;
  user_id: string;
}

export const useChatList = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  const fetchChats = async () => {
    try {
      const response = await chatService.getAllChats();
      // Sort chats by last_used_at in descending order (most recent first)
      const sortedChats = response.sort((a, b) => 
        new Date(b.last_used_at || b.created_at).getTime() - new Date(a.last_used_at || a.created_at).getTime()
      );
      setChats(sortedChats);
    } catch (error) {
      console.error('Error fetching chats:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch chats. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();
  }, []);

  const createNewChat = async () => {
    try {
      const chatId = await chatService.createChat();
      toast({
        title: 'Success',
        description: 'New chat created successfully',
      });
      navigate('/');
    } catch (error) {
      console.error('Error creating chat:', error);
      toast({
        title: 'Error',
        description: 'Failed to create new chat. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const selectChat = async (chatId: string) => {
    try {
      await chatService.getChat(chatId);
      navigate(`/chat/${chatId}`);
    } catch (error) {
      console.error('Error selecting chat:', error);
      toast({
        title: 'Error',
        description: 'Failed to select chat. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const updateChatName = async (chatId: string, name: string) => {
    try {
      await chatService.updateChatName(chatId, name);
      // Refresh the chat list to show the updated name
      await fetchChats();
    } catch (error) {
      console.error('Error updating chat name:', error);
      throw error;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return {
    chats,
    loading,
    createNewChat,
    selectChat,
    updateChatName,
    formatDate,
  };
}; 