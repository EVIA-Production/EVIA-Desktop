import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center mb-8">
        <Button
          variant="outline"
          className="border-border bg-transparent hover:bg-accent text-muted-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
        </Button>
      </div>
      
      <h1 className="text-4xl font-bold mb-8 text-center">About EVIA</h1>
      
      <Tabs defaultValue="about" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="about">About & Tutorial</TabsTrigger>
          <TabsTrigger value="privacy">Datenschutzerklärung</TabsTrigger>
        </TabsList>
        
        <TabsContent value="about">
          <Card>
            <CardHeader>
              <CardTitle>About EVIA</CardTitle>
              <CardDescription>Your AI-powered virtual assistant</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-6">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4">What is EVIA?</h2>
                    <p className="text-gray-700 dark:text-gray-300">
                      EVIA is an advanced AI-powered virtual assistant designed to help you with various tasks
                      and provide intelligent responses to your queries. Our platform combines cutting-edge
                      artificial intelligence with user-friendly interfaces to deliver a seamless experience.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">Getting Started</h2>
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-xl font-medium mb-2">1. Create an Account</h3>
                        <p className="text-gray-700 dark:text-gray-300">
                          Sign up for an account to access all features of EVIA. The registration process
                          is quick and straightforward.
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xl font-medium mb-2">2. Start a Chat</h3>
                        <p className="text-gray-700 dark:text-gray-300">
                          Navigate to the chat section and start a new conversation with EVIA. You can
                          ask questions, request assistance, or engage in meaningful discussions.
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xl font-medium mb-2">3. Explore Features</h3>
                        <p className="text-gray-700 dark:text-gray-300">
                          Discover the various features and capabilities of EVIA. From answering questions
                          to providing detailed explanations, EVIA is here to help.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">Tips for Best Results</h2>
                    <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
                      <li>Be specific in your questions for more accurate responses</li>
                      <li>Use clear and concise language</li>
                      <li>Provide context when necessary</li>
                      <li>Feel free to ask follow-up questions</li>
                    </ul>
                  </section>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="privacy">
          <Card>
            <CardHeader>
              <CardTitle>Datenschutzerklärung</CardTitle>
              <CardDescription>Privacy Policy</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-6 text-gray-700 dark:text-gray-300">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4">1. Datenschutz auf einen Blick</h2>
                    <h3 className="text-xl font-medium mb-2">Allgemeine Hinweise</h3>
                    <p>
                      Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren
                      personenbezogenen Daten passiert, wenn Sie diese Website besuchen.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">2. Datenerfassung auf dieser Website</h2>
                    <h3 className="text-xl font-medium mb-2">Wer ist verantwortlich für die Datenerfassung?</h3>
                    <p>
                      Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber.
                      Dessen Kontaktdaten können Sie dem Impressum dieser Website entnehmen.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">3. Allgemeine Hinweise und Pflichtinformationen</h2>
                    <h3 className="text-xl font-medium mb-2">Datenschutz</h3>
                    <p>
                      Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst.
                      Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der
                      gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">4. Datenerfassung auf dieser Website</h2>
                    <h3 className="text-xl font-medium mb-2">Cookies</h3>
                    <p>
                      Unsere Website verwendet Cookies. Das sind kleine Textdateien, die Ihr Webbrowser
                      auf Ihrem Endgerät speichert. Cookies helfen uns dabei, unser Angebot nutzerfreundlicher,
                      effektiver und sicherer zu machen.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">5. Analyse-Tools und Werbung</h2>
                    <p>
                      Wir verwenden verschiedene Analyse-Tools, um die Nutzung unserer Website zu
                      verbessern und Ihnen ein optimales Nutzererlebnis zu bieten.
                    </p>
                  </section>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default About; 