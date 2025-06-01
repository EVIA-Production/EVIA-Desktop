import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto py-8 px-4 min-h-screen">
      <div className="flex items-center mb-8">
        <Button
          variant="outline"
          className="border-border bg-transparent hover:bg-accent text-muted-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
      
      <h1 className="text-4xl font-bold mb-8 text-center">Privacy Policy</h1>
      
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Privacy Policy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 text-gray-700 dark:text-gray-300">
            <section>
              <h2 className="text-2xl font-semibold mb-4">1. Who we are</h2>
              <p>EVIA GBR, Munich, Germany. Contact us: bene.kroetz@gmail.com</p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">2. Data we collect</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your interview audio recordings.</li>
                <li>Transcripts of them.</li>
                <li>Metadata: IP, time, device.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">3. Why we need it</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Transcription in real time.</li>
                <li>Recommendations for conversations.</li>
                <li>Improving our system.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">4. Legal basis</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your consent.</li>
                <li>Our legitimate interest in helping you.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">5. Who receives the data (when using EVIA)</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Deepgram (USA): Transcription.</li>
                <li>Groq (USA): Recommendations.</li>
                <li>Microsoft Azure (EU): Storage.</li>
              </ul>
              <p className="mt-2">Data goes to the US, but we have safeguards (SCCs).</p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">6. How long we keep them</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Audio: Deleted after 24 hours.</li>
                <li>Transcripts: Until you delete them or pilot phase ends.</li>
                <li>Metadata: As long as necessary.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">7. Your rights</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Look at your data.</li>
                <li>Change them.</li>
                <li>Delete it.</li>
                <li>Say no to processing.</li>
                <li>Take your data with you.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">8. Security</h2>
              <p>We encrypt everything. Only authorized persons have access.</p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4">9. Changes</h2>
              <p>We update this. New versions are on our website.</p>
            </section>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PrivacyPolicy; 